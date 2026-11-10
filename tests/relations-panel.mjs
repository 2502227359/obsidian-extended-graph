import assert from 'node:assert/strict';
import { Menu } from 'obsidian';
import { ExtendedGraphInstances } from '../src/pluginInstances.ts';
import { waitFor } from './graph-fixture.mjs';

export async function relationsPanel(plugin) {
    const { app } = plugin;
    const source = app.vault.getAbstractFileByPath('notes/A.md');
    const neighbor = app.vault.getAbstractFileByPath('notes/B.md');
    const savedSource = await app.vault.cachedRead(source);
    const savedNeighbor = await app.vault.cachedRead(neighbor);
    const leaf = app.workspace.getLeaf('tab');
    const menu = new Menu();
    try {
        leaf.setPinned(true);
        await leaf.setViewState({ type: 'localgraph', state: { file: source.path }, active: true });
        leaf.setPinned(false);
        await waitFor(() => leaf.view.renderer?.nodes.length > 0, '局部图谱应完成初始化');
        const manager = ExtendedGraphInstances.graphsManager;
        manager.graphLeavesManager.initLeaf(leaf);
        manager.lifecycleManager.enablePlugin(leaf.view, undefined, false);
        await waitFor(() => manager.allInstances.get(leaf.id)?.graphEventsDispatcher.inputsManager, '局部增强应完成初始化');
        manager.onNodeMenuOpened(menu, neighbor, 'graph-context-menu', leaf);
        menu.showAtPosition({ x: 100, y: 100 });
        const entry = [...menu.dom.querySelectorAll('.menu-item')].find(item => item.textContent.includes('查看与中心关联'));
        assert.ok(entry, '局部图谱节点菜单应提供关联位置入口');
        entry.click();
        await waitFor(() => leaf.view.contentEl.querySelector('.eg-relations-target'), '菜单操作应显示真实关联');
        const panel = leaf.view.contentEl.querySelector('.eg-relations-panel');
        assert.ok(panel.textContent.includes('整篇引用'));
        assert.equal(panel.dataset.center, source.path);
        assert.equal(panel.dataset.neighbor, neighbor.path);
        assert.equal(leaf.pinned, true, '打开关联期间应固定原图谱中心');
        const requests = [];
        const ref = app.workspace.on('hover-link', request => requests.push(request));
        try {
            const target = panel.querySelector('.eg-relations-target');
            target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 200, clientY: 200 }));
            await waitFor(() => requests.length > 0, '悬浮前重新核对位置后应发出预览请求');
            assert.equal(requests.at(-1).linktext, neighbor.path);
            assert.equal(requests.at(-1).sourcePath, source.path);
            assert.equal(requests.at(-1).targetEl, target);
            await assertHoverCancellation(app, panel, requests);
        } finally {
            app.workspace.offref(ref);
        }
        await assertClickSurvivesMouseout(app, panel);
        await assertRefresh(app, panel, source, neighbor, savedSource);
        panel.querySelector('.eg-relations-close').click();
        assert.equal(leaf.view.contentEl.querySelector('.eg-relations-panel'), null, '关闭后应移除关联面板');
        assert.equal(leaf.pinned, false, '关闭后应恢复原先未固定的状态');
        await assertCenterChange(plugin, leaf, neighbor);
    } finally {
        menu.hide();
        leaf.detach();
        await app.vault.modify(source, savedSource);
        await app.vault.modify(neighbor, savedNeighbor);
    }
}

async function assertRefresh(app, panel, source, neighbor, savedSource) {
    await app.vault.modify(neighbor, '# 新目标\n\n目标正文。\n');
    await app.vault.modify(source, savedSource + '\n[[notes/B#新目标]]\n');
    await waitFor(() => [...panel.querySelectorAll('.eg-relations-target')].some(item => item.textContent === '新目标' && !item.hasAttribute('aria-disabled')), '笔记增加引用后应更新面板');
    await app.vault.modify(neighbor, '# 已改名\n');
    await waitFor(() => panel.textContent.includes('定位已失效'), '目标标题失效后应提示，不能继续预览旧位置');
    const invalid = [...panel.querySelectorAll('.eg-relations-target')].find(item => item.textContent === '新目标');
    assert.equal(invalid.getAttribute('aria-disabled'), 'true');
}

async function assertHoverCancellation(app, panel, requests) {
    const originalRead = app.vault.cachedRead;
    const pending = [];
    app.vault.cachedRead = function (file) {
        return new Promise((resolve, reject) => pending.push(() => originalRead.call(this, file).then(resolve, reject)));
    };
    try {
        const before = requests.length;
        const target = panel.querySelector('.eg-relations-target');
        target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: panel }));
        await Promise.all(pending.map(release => release()));
        await new Promise(resolve => setTimeout(resolve, 60));
        assert.equal(requests.length, before, '读取期间离开链接后，不得弹出过期位置的预览');
    } finally {
        app.vault.cachedRead = originalRead;
    }
}

async function assertClickSurvivesMouseout(app, panel) {
    const originalRead = app.vault.cachedRead;
    const pending = [];
    const before = new Set(app.workspace.getLeavesOfType('markdown').map(leaf => leaf.id));
    let remaining = 2;
    app.vault.cachedRead = function (file) {
        if (remaining-- > 0) return new Promise((resolve, reject) => pending.push(() => originalRead.call(this, file).then(resolve, reject)));
        return originalRead.call(this, file);
    };
    try {
        const target = panel.querySelector('.eg-relations-target');
        target.click();
        target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: panel }));
        await Promise.all(pending.map(release => release()));
        await waitFor(() => app.workspace.getLeavesOfType('markdown').some(leaf => !before.has(leaf.id) && leaf.view.file?.path === 'notes/B.md'), '点击后移开鼠标仍应打开目标文件');
    } finally {
        app.vault.cachedRead = originalRead;
        for (const leaf of app.workspace.getLeavesOfType('markdown')) if (!before.has(leaf.id)) leaf.detach();
    }
}

async function assertCenterChange(plugin, leaf, neighbor) {
    const menu = new Menu();
    try {
        ExtendedGraphInstances.graphsManager.onNodeMenuOpened(menu, neighbor, 'graph-context-menu', leaf);
        menu.showAtPosition({ x: 100, y: 100 });
        [...menu.dom.querySelectorAll('.menu-item')].find(item => item.textContent.includes('查看与中心关联')).click();
        await waitFor(() => leaf.view.contentEl.querySelector('.eg-relations-target'), '应重新打开关联面板');
        await leaf.setViewState({ type: 'localgraph', state: { file: 'notes/C.md' }, active: true });
        await waitFor(() => !leaf.view.contentEl.querySelector('.eg-relations-panel'), '用户主动换中心后应移除旧关系面板');
        assert.equal(leaf.view.file?.path, 'notes/C.md');
        assert.equal(leaf.pinned, false, '移除旧关系面板后应恢复固定状态');
    } finally {
        menu.hide();
    }
}
