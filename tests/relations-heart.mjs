import assert from 'node:assert/strict';
import { Menu, parseLinktext, resolveSubpath } from 'obsidian';
import { ExtendedGraphInstances } from '../src/pluginInstances.ts';
import { readRelations } from '../src/relations/relations.ts';
import { waitFor } from './graph-fixture.mjs';

export const HEART = '临床医学/临床医学/内科学/3.2 心力衰竭.md';
export const DRUGS = '临床医学/基础医学/药理学/第二十六章 治疗心力衰竭的药物.md';
export const NERVES = '临床医学/基础医学/生理生化基础/1.4.4 心血管调节-神经调节.md';

async function openRelations(plugin, path, neighbor, direct = false) {
    const leaf = plugin.app.workspace.getLeaf('tab');
    leaf.setPinned(true);
    await leaf.setViewState({ type: 'localgraph', state: { file: path }, active: true });
    leaf.setPinned(false);
    await waitFor(() => leaf.view.renderer?.nodes.length > 0, '心衰局部图谱应就绪');
    const manager = ExtendedGraphInstances.graphsManager;
    manager.graphLeavesManager.initLeaf(leaf);
    manager.lifecycleManager.enablePlugin(leaf.view, undefined, false);
    await waitFor(() => manager.allInstances.get(leaf.id)?.graphEventsDispatcher.inputsManager, '心衰图谱增强应就绪');
    try {
        if (direct) {
            leaf.view.renderer.onNodeClick(new MouseEvent('click', { altKey: true, button: 0, clientX: 600, clientY: 400, cancelable: true }), neighbor, '');
            await waitFor(() => leaf.view.contentEl.querySelector('.eg-relations-panel')?.dataset.neighbor === neighbor, 'Alt 单击应直接打开真实关联位置');
        } else await selectRelations(plugin, leaf, neighbor);
        assert.equal(leaf.view.file.path, path, '菜单应绑定指定的局部图谱中心');
        return leaf;
    } catch (error) {
        leaf.detach();
        throw error;
    }
}

async function selectRelations(plugin, leaf, neighbor) {
    const menu = new Menu();
    try {
        ExtendedGraphInstances.graphsManager.onNodeMenuOpened(menu, plugin.app.vault.getAbstractFileByPath(neighbor), 'graph-context-menu', leaf);
        menu.showAtPosition({ x: 120, y: 120 });
        const entry = [...menu.dom.querySelectorAll('.menu-item')].find(item => item.textContent.includes('查看与中心关联'));
        assert.ok(entry, '真实心衰图谱应有菜单入口');
        entry.click();
        await waitFor(() => leaf.view.contentEl.querySelector('.eg-relations-count')?.textContent.includes('次引用'), '关联面板应出现');
        assert.ok(leaf.view.contentEl.querySelector('.eg-relations-target'), `应找到直接关联：${leaf.view.contentEl.querySelector('.eg-relations-panel')?.textContent}`);
    } finally {
        menu.hide();
    }
}

function hoverView(app, targetPath, subpath) {
    return app.plugins.plugins['hover-editor-zh'].activePopovers
        .filter(popover => popover.originalLinkText === targetPath + subpath)
        .flatMap(popover => popover.leaves()).find(leaf => leaf.view.file?.path === targetPath)?.view;
}

async function assertPreview(app, anchor, path, subpath) {
    anchor.scrollIntoView({ block: 'nearest' });
    const rect = anchor.getBoundingClientRect();
    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: rect.left + 8, clientY: rect.top + 8 }));
    return assertVisiblePreview(app, path, subpath);
}

async function assertVisiblePreview(app, path, subpath) {
    const target = app.vault.getAbstractFileByPath(path);
    const resolved = resolveSubpath(app.metadataCache.getFileCache(target), subpath);
    assert.ok(resolved, `验收目标应可解析：${subpath}`);
    await waitFor(() => hoverView(app, path, subpath)?.currentMode?.getScroll?.() > 0, `悬浮编辑器应滚动至 ${subpath}`);
    const view = hoverView(app, path, subpath);
    assert.equal(view.getMode(), 'preview', '应使用真实阅读模式验收');
    if (resolved.type === 'heading') {
        const container = view.previewMode.containerEl;
        await waitFor(() => [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')].some(heading => {
            if (heading.textContent.trim() !== resolved.current.heading) return false;
            const bounds = heading.getBoundingClientRect();
            const viewport = container.getBoundingClientRect();
            return bounds.height > 0 && bounds.bottom > viewport.top && bounds.top < viewport.bottom;
        }), `目标标题应进入悬浮窗视口：${subpath}`);
    } else {
        assert.ok(Math.abs(view.currentMode.getScroll() - resolved.start.line) < 6, '块位置应进入悬浮窗视口');
    }
    return view;
}

export async function relationsDirectHeart(plugin) {
    const { app } = plugin;
    let leaf, firstParent;
    const ref = app.workspace.on('hover-link', request => {
        if (request.linktext === DRUGS + '#2.3 心肌肾上腺素β受体信号转导的变化') firstParent = request.hoverParent;
    });
    try {
        leaf = await openRelations(plugin, HEART, DRUGS, true);
        await waitFor(() => firstParent?.hoverPopover, '真实悬浮编辑器应接管首次预览请求');
        leaf.view.containerEl.win.document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
        await assertVisiblePreview(app, DRUGS, '#2.3 心肌肾上腺素β受体信号转导的变化');
        let panel = leaf.view.contentEl.querySelector('.eg-relations-panel');
        assert.equal(panel.querySelectorAll('.eg-relations-group').length, 21);
        assert.ok(panel.querySelector('.eg-relations-count').textContent.includes('34 次引用'));
        const next = [...panel.querySelectorAll('.eg-relations-target')].find(item => item.textContent === '📚 第三节 利尿药');
        next.click();
        await assertVisiblePreview(app, DRUGS, '#📚 第三节 利尿药');
        next.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
        next.click();
        await assertVisiblePreview(app, DRUGS, '#📚 第三节 利尿药');
        leaf.view.renderer.onNodeClick(new MouseEvent('click', { altKey: true, button: 0, clientX: 600, clientY: 400 }), NERVES, '');
        await assertVisiblePreview(app, NERVES, '#^sympathetic-cardiac-effects');
        const thirst = '临床医学/问题辨析/解析/利尿后口渴为什么不会抵消容量下降.md';
        leaf.view.renderer.onNodeClick(new MouseEvent('click', { altKey: true, button: 0, clientX: 600, clientY: 400 }), thirst, '');
        await waitFor(() => hoverView(app, HEART, '')?.currentMode?.getScroll?.() > 400, '整篇链接应自动定位心衰中的引用原文，而非笔记开头');
        const view = hoverView(app, HEART, '');
        assert.equal(view.getMode(), 'preview');
        const container = view.previewMode.containerEl;
        await waitFor(() => [...container.querySelectorAll('p,li')].some(element => {
            const bounds = element.getBoundingClientRect(), viewport = container.getBoundingClientRect();
            return element.textContent.includes('推导过程见') && bounds.height > 0 && bounds.bottom > viewport.top && bounds.top < viewport.bottom;
        }), '整篇链接的真实引用段落应进入浮窗视口');
        assert.equal(leaf.view.file.path, HEART, '自动聚焦浮窗时应保持图谱根中心');
        panel = leaf.view.contentEl.querySelector('.eg-relations-panel');
        panel.querySelector('.eg-relations-close').click();
        assert.equal(leaf.pinned, false);
    } finally {
        app.workspace.offref(ref);
        leaf?.detach();
        for (const popover of [...app.plugins.plugins['hover-editor-zh'].activePopovers]) popover.hide();
    }
}

export async function relationsHeart(plugin) {
    const { app } = plugin;
    await waitFor(() => app.metadataCache.getCache(HEART)?.links?.length > 0 && app.metadataCache.getCache(DRUGS)?.headings?.length > 0, '真实样本应完成索引');
    const groups = await readRelations(app, HEART, DRUGS);
    assert.equal(groups.length, 21, '心衰与药理章应有 21 个目标位置');
    assert.equal(groups.reduce((sum, group) => sum + group.occurrences.length, 0), 34, '应保留 34 处引用');
    assert.ok(groups.every(group => group.status === 'valid'));
    const settings = ExtendedGraphInstances.settings;
    const previousLimit = settings.maxNodes;
    settings.maxNodes = 1000;
    let leaf;
    try {
        leaf = await openRelations(plugin, HEART, DRUGS);
        const panel = leaf.view.contentEl.querySelector('.eg-relations-panel');
        assert.equal(panel.querySelectorAll('.eg-relations-group').length, 21);
        for (const title of ['📚 第三节 利尿药', '📚 第四节 β肾上腺素受体阻断药']) {
            const anchor = [...panel.querySelectorAll('.eg-relations-target')].find(item => item.textContent === title);
            assert.ok(anchor, `面板应显示 ${title}`);
            await assertPreview(app, anchor, DRUGS, '#' + title);
            assert.equal(leaf.view.file.path, HEART, '预览不能把局部图谱中心换成目标文件');
            assert.equal(panel.dataset.center, HEART, '活动浮窗不能改写面板绑定的来源');
        }
        panel.querySelector('details').open = true;
        const source = panel.querySelector('.eg-relations-source');
        const beforeOpen = new Set(app.workspace.getLeavesOfType('markdown').map(item => item.id));
        source.click();
        await waitFor(() => app.workspace.getLeavesOfType('markdown').some(item => !beforeOpen.has(item.id) && item.view.file?.path === HEART), '点击引用原文应在新标签页打开来源笔记');
        assert.equal(leaf.view.file?.path, HEART, '打开引用原文时也应保持原图谱中心');
        await selectRelations(plugin, leaf, NERVES);
        const block = [...leaf.view.contentEl.querySelectorAll('.eg-relations-target')].find(item => item.textContent.includes('sympathetic-cardiac-effects'));
        assert.ok(block, '心衰真实块引用应显示');
        await assertPreview(app, block, NERVES, '#^sympathetic-cardiac-effects');
        leaf.view.contentEl.querySelector('.eg-relations-close').click();
        assert.equal(leaf.view.contentEl.querySelectorAll('.eg-relations-panel').length, 0);
    } finally {
        leaf?.detach();
        settings.maxNodes = previousLimit;
        for (const popover of [...app.plugins.plugins['hover-editor-zh'].activePopovers]) popover.hide();
    }
}
