import assert from 'node:assert/strict';
import { ExtendedGraphInstances } from '../src/pluginInstances.ts';
import { waitFor } from './graph-fixture.mjs';

export async function polishFixture(plugin) {
    const { app } = plugin, folder = 'relations-polish', files = [];
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
    files.push(await app.vault.create(folder + '/Root.md', '# 治疗\n[[Target#1.1 常用药物|ACEI]]\n[[Target#1.1 常用药物|另一名称]]\n[[Target#2.2 常用药物|ARB]]\n'));
    files.push(await app.vault.create(folder + '/Target.md', '# 1.1 常用药物\n正文\n# 2.2 常用药物\n正文\n[[Root]]\n'));
    await waitFor(() => app.metadataCache.resolvedLinks[files[0].path]?.[files[1].path] && app.metadataCache.getFileCache(files[1])?.headings?.length === 2, '精修样本应完成索引');
    const leaf = app.workspace.getLeaf('tab');
    leaf.setPinned(true);
    await leaf.setViewState({ type: 'localgraph', state: { file: files[0].path }, active: true });
    leaf.setPinned(false);
    const manager = ExtendedGraphInstances.graphsManager;
    manager.graphLeavesManager.initLeaf(leaf);
    manager.lifecycleManager.enablePlugin(leaf.view, undefined, false);
    await waitFor(() => manager.allInstances.get(leaf.id)?.graphEventsDispatcher.inputsManager, '精修图谱增强应就绪');
    const inputs = manager.allInstances.get(leaf.id).graphEventsDispatcher.inputsManager;
    return { app, leaf, files, inputs };
}

export async function cleanPolish({ app, leaf, files }) {
    leaf.detach();
    const editor = app.plugins.plugins['hover-editor-zh'];
    const owned = popover => files.some(file => popover.originalLinkText?.split('#')[0] === file.path);
    for (const popover of [...editor?.activePopovers ?? []]) if (owned(popover)) popover.hide();
    await waitFor(() => !editor?.activePopovers.some(owned), '测试浮窗应完成异步关闭，不能影响下一项的焦点');
    for (const tab of app.workspace.getLeavesOfType('markdown')) if (files.some(file => file.path === tab.view.file?.path)) tab.detach();
    for (const file of files) if (app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file);
}

export async function relationsPolishLabels(plugin) {
    const fixture = await polishFixture(plugin), { leaf, files, inputs } = fixture;
    try {
        inputs.showRelations(files[1].path);
        await waitFor(() => leaf.view.contentEl.querySelectorAll('.eg-relations-group').length === 3, '应保留两处目标和整篇反链');
        const panel = leaf.view.contentEl.querySelector('.eg-relations-panel');
        await Promise.all(panel.getAnimations().map(animation => animation.finished.catch(() => {})));
        const targets = [...panel.querySelectorAll('.eg-relations-target')];
        assert.deepEqual(targets.map(a => a.textContent), ['ACEI', 'ARB', '整篇引用'], '应使用真实链接别名提高辨识度');
        assert.equal(panel.querySelector('.eg-relations-location').textContent, '1.1 常用药物');
        assert.ok(panel.querySelector('.eg-relations-aliases').textContent.includes('另一名称'), '同一位置的其他别名应保留');
        assert.ok(!panel.querySelector('.eg-relations-group .eg-relations-direction').textContent.includes('Root'), '卡片不应重复整对文件名');
        assert.ok(panel.querySelectorAll('.eg-relations-direction')[panel.querySelectorAll('.eg-relations-direction').length - 1].textContent.includes('关联笔记 → 中心'), '反链方向仍须明确');
        const top = targets[0].getBoundingClientRect().top;
        targets[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await waitFor(() => targets[0].hasAttribute('aria-current'), '普通悬浮也应标出定位项');
        assert.ok(Math.abs(targets[0].getBoundingClientRect().top - top) < 1, '定位状态文字不能把鼠标下的条目挤走');
    } finally { await cleanPolish(fixture); }
}

export async function relationsPolishFeedback(plugin) {
    const fixture = await polishFixture(plugin), { app, leaf, files, inputs } = fixture;
    const original = app.vault.cachedRead;
    let release;
    try {
        inputs.previewRelations(files[1].path, new MouseEvent('click', { altKey: true, button: 0 }));
        await waitFor(() => leaf.view.contentEl.querySelector('[aria-current="location"]'), '自动定位后应标出实际选择的位置');
        const panel = leaf.view.contentEl.querySelector('.eg-relations-panel');
        const gate = new Promise(resolve => { release = resolve; });
        app.vault.cachedRead = async function (file) { if (files.includes(file)) await gate; return original.call(this, file); };
        panel.querySelectorAll('.eg-relations-target')[1].click();
        await waitFor(() => panel.getAttribute('aria-busy') === 'true' && panel.textContent.includes('正在定位'), '慢读取应有定位反馈');
        release();
        await waitFor(() => panel.querySelector('[aria-current="location"]')?.textContent === 'ARB', '定位完成应同步当前选择');
        assert.equal(panel.getAttribute('aria-busy'), 'false');
        const refreshGate = new Promise(resolve => { release = resolve; });
        app.vault.cachedRead = async function (file) { if (files.includes(file)) await refreshGate; return original.call(this, file); };
        app.metadataCache.trigger('changed', files[0], '', app.metadataCache.getFileCache(files[0]));
        await waitFor(() => panel.getAttribute('aria-busy') === 'true' && panel.textContent.includes('正在刷新关联'), '慢刷新也须显示反馈');
        release();
        await waitFor(() => panel.getAttribute('aria-busy') === 'false', '刷新结束应清理反馈');
        let fail = true;
        app.vault.cachedRead = async function (file) { if (file === files[1] && fail) { fail = false; throw Error('测试读取失败'); } return original.call(this, file); };
        app.metadataCache.trigger('changed', files[0], '', app.metadataCache.getFileCache(files[0]));
        await waitFor(() => panel.textContent.includes('关联读取失败'), '读取错误应有明确反馈');
        assert.ok(!panel.querySelector('.eg-relations-count').textContent.includes('3 个'), '失败后不能留下旧计数');
        assert.equal(panel.querySelector('[aria-current]'), null, '失败后不能保留旧定位状态');
    } finally {
        release?.();
        app.vault.cachedRead = original;
        await cleanPolish(fixture);
    }
}

export async function relationsPolishRefresh(plugin) {
    const fixture = await polishFixture(plugin), { app, leaf, files, inputs } = fixture;
    try {
        inputs.previewRelations(files[1].path, new MouseEvent('click', { altKey: true, button: 0 }));
        await waitFor(() => leaf.view.contentEl.querySelector('[aria-current="location"]'), '应选择第一处');
        const panel = leaf.view.contentEl.querySelector('.eg-relations-panel');
        panel.querySelector('.eg-relations-source').closest('details').open = true;
        const text = await app.vault.cachedRead(files[0]);
        await app.vault.modify(files[0], text + '\n新内容\n');
        await waitFor(() => panel.querySelector('.eg-relations-source') !== null && panel.querySelector('.eg-relations-source').isConnected && app.metadataCache.getFileCache(files[0])?.sections?.length > 1, '样本更新应完成');
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(panel.querySelector('.eg-relations-source').closest('details').open, true, '元数据更新不能收起正在阅读的原文');
        assert.equal(panel.querySelector('[aria-current="location"]')?.textContent, 'ACEI', '更新后仍应标明当前选择');
        const source = panel.querySelectorAll('.eg-relations-source')[1];
        source.click();
        await waitFor(() => source.hasAttribute('aria-current'), '应能选择第二处引用原文');
        await app.vault.modify(files[0], '# 治疗\n新增：[[Target#1.1 常用药物|ACEI]]\n' + text.split('\n').slice(1).join('\n'));
        await waitFor(() => panel.querySelectorAll('.eg-relations-source').length === 5, '新引用应更新面板');
        const current = panel.querySelector('[aria-current="location"]');
        assert.ok(!current || current.closest('.eg-relations-occurrence').textContent.includes('另一名称'), '前面插入引用不能将选择恢复到另一处原文');
        const folder = 'relations-polish/other';
        if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
        const same = await app.vault.create(folder + '/Root.md', '# 同名笔记\n');
        files.push(same);
        inputs.showRelations(same.path);
        await waitFor(() => leaf.view.contentEl.querySelector('.eg-relations-pair')?.textContent.includes('other/Root.md'), '同名文件应显示必要路径');
        assert.ok(leaf.view.contentEl.querySelector('.eg-relations-pair').textContent.includes('relations-polish/Root.md'));
    } finally { await cleanPolish(fixture); }
}
