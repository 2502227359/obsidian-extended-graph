import assert from 'node:assert/strict';
import { ExtendedGraphInstances } from '../src/pluginInstances.ts';
import { waitFor } from './graph-fixture.mjs';

async function openLocal(plugin, path = 'notes/A.md', neighbor = 'notes/B.md') {
    const leaf = plugin.app.workspace.getLeaf('tab');
    leaf.setPinned(true);
    await leaf.setViewState({ type: 'localgraph', state: { file: path }, active: true });
    leaf.setPinned(false);
    await waitFor(() => leaf.view.renderer?.nodes.some(node => node.id === neighbor), '命令测试局部图应就绪');
    const manager = ExtendedGraphInstances.graphsManager;
    manager.graphLeavesManager.initLeaf(leaf);
    manager.lifecycleManager.enablePlugin(leaf.view, undefined, false);
    await waitFor(() => manager.allInstances.get(leaf.id)?.graphEventsDispatcher.inputsManager, '命令测试增强应就绪');
    return leaf;
}

async function createFiles(app) {
    const folder = 'commands-fixtures';
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
    const files = [];
    for (const [name, text] of [['Root', '# 中心\n[[A]]'], ['A', '# 甲\n[[B]]'], ['B', '# 乙\n[[C]]'], ['C', '# 丙']]) {
        files.push(await app.vault.create(`${folder}/${name}.md`, text));
    }
    await waitFor(() => files.slice(0, -1).every((file, index) => app.metadataCache.resolvedLinks[file.path]?.[files[index + 1].path]), '命令样本链接应完成解析');
    return files;
}

function execute(app, name) {
    assert.equal(app.commands.executeCommandById(`extended-graph:${name}`), true, `命令应执行：${name}`);
}

export async function relationsCommandActions(plugin) {
    const { app } = plugin;
    const ids = ['toggle-hover-relations', 'show-node-relations', 'expand-node-branch', 'collapse-node-branch', 'clear-manual-branches', 'keep-preview-branch', 'toggle-relation-sources', 'close-node-relations'];
    for (const id of ids) {
        const command = app.commands.findCommand(`extended-graph:${id}`);
        assert.ok(command, `近期功能应提供命令：${id}`);
        assert.ok(command.name.includes('局部关联：'), '命令应能用统一中文前缀搜索');
        assert.equal(command.hotkeys, undefined);
    }
    const files = await createFiles(app);
    const leaf = await openLocal(plugin, files[0].path, files[1].path);
    try {
        execute(app, 'toggle-hover-relations');
        leaf.view.renderer.onNodeHover(new MouseEvent('mousemove', { clientX: 500, clientY: 350 }), files[1].path, '');
        execute(app, 'show-node-relations');
        await waitFor(() => leaf.view.contentEl.querySelector('.eg-relations-panel')?.dataset.neighbor === files[1].path, '悬浮目标应打开与图谱中心的关联');
        execute(app, 'close-node-relations');
        assert.equal(leaf.view.contentEl.querySelector('.eg-relations-panel'), null);
        assert.equal(app.commands.findCommand('extended-graph:close-node-relations').checkCallback(true), false);
        execute(app, 'expand-node-branch');
        await waitFor(() => leaf.view.renderer.nodes.some(node => node.id === files[2].path), '展开命令应加入下一层');
        execute(app, 'collapse-node-branch');
        await waitFor(() => !leaf.view.renderer.nodes.some(node => node.id === files[2].path), '收起命令应移除该层独占节点');
        execute(app, 'expand-node-branch');
        execute(app, 'clear-manual-branches');
        await waitFor(() => !leaf.view.renderer.nodes.some(node => node.id === files[2].path), '清除命令应移除手动分支');
        await assertPreviewCommands(app, leaf, files);
        await assertGhostExpand(app, leaf, files);
    } finally {
        leaf.detach();
        for (const file of files) if (app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file);
    }
}

async function assertPreviewCommands(app, leaf, files) {
    leaf.view.renderer.onNodeHover(new MouseEvent('mousemove', { clientX: 500, clientY: 350 }), files[1].path, '');
    const panel = leaf.view.contentEl.querySelector('.eg-branch-preview');
    await waitFor(() => panel?.dataset.anchor === files[1].path && !panel.hidden, '保留前应有悬浮预览');
    panel.dispatchEvent(new PointerEvent('pointerenter'));
    panel.querySelector(`g[data-path="${files[2].path}"]`).dispatchEvent(new PointerEvent('pointerenter', { clientX: 560, clientY: 380 }));
    await waitFor(() => panel.dataset.anchor === files[2].path, '应进入第二层预览');
    execute(app, 'toggle-relation-sources');
    assert.equal(panel.dataset.includeSources, 'true', '来源命令应同步小图状态');
    execute(app, 'keep-preview-branch');
    await waitFor(() => leaf.view.renderer.nodes.some(node => node.id === files[3].path), '保留命令应将当前预览层加入正式图');
    assert.equal(app.commands.findCommand('extended-graph:keep-preview-branch').checkCallback(true), false, '已保留的层不能重复保留');
    execute(app, 'clear-manual-branches');
}

async function assertGhostExpand(app, leaf, files) {
    const instance = ExtendedGraphInstances.graphsManager.allInstances.get(leaf.id);
    const saved = { ...instance.engine.getOptions() };
    try {
        instance.engine.setOptions({ ...saved, localBacklinks: false, localForelinks: true });
        leaf.view.renderer.onNodeHover(new MouseEvent('mousemove', { clientX: 500, clientY: 350 }), files[1].path, '');
        const panel = leaf.view.contentEl.querySelector('.eg-branch-preview');
        await waitFor(() => panel?.dataset.anchor === files[1].path && !panel.hidden, '仅出链预览应就绪');
        panel.dispatchEvent(new PointerEvent('pointerenter'));
        panel.querySelector(`g[data-path="${files[2].path}"]`).dispatchEvent(new PointerEvent('pointerenter', { clientX: 570, clientY: 390 }));
        await waitFor(() => panel.dataset.anchor === files[2].path, '仅出链应进入临时节点的下一层');
        execute(app, 'expand-node-branch');
        await waitFor(() => leaf.view.renderer.nodes.some(node => node.id === files[3].path), '临时节点命令应展开下一层');
        assert.ok(leaf.view.renderer.links.some(link => link.source.id === files[1].path && link.target.id === files[2].path), '临时节点展开命令应保留进入路径，不能形成断开的分支');
        execute(app, 'clear-manual-branches');
    } finally {
        instance.engine.setOptions(saved);
    }
}

export async function relationsCommands(plugin) {
    const { app } = plugin;
    const id = 'extended-graph:toggle-hover-relations';
    const command = app.commands.findCommand(id);
    assert.ok(command, '新增的悬浮关联功能应注册为可绑定快捷键的命令');
    assert.equal(command.hotkeys, undefined, '不能替用户预设组合键');
    const first = await openLocal(plugin), second = await openLocal(plugin);
    const hadCustomKeys = Object.hasOwn(app.hotkeyManager.customKeys, id);
    const originalKeys = app.hotkeyManager.getHotkeys(id);
    try {
        assert.equal(command.checkCallback(true), true);
        assert.equal(second.view.contentEl.querySelector('.eg-hover-branches-toggle').getAttribute('aria-pressed'), 'false', '可用性检查不能执行操作');
        app.hotkeyManager.setHotkeys(id, [{ modifiers: ['Mod', 'Alt'], key: 'F13' }]);
        assert.deepEqual(app.hotkeyManager.getHotkeys(id), [{ modifiers: ['Mod', 'Alt'], key: 'F13' }]);
        second.view.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'F13', code: 'F13', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
        await waitFor(() => second.view.contentEl.querySelector('.eg-hover-branches-toggle').getAttribute('aria-pressed') === 'true', '用户分配的快捷键应通过宿主键盘事件切换当前图谱');
        assert.equal(first.view.contentEl.querySelector('.eg-hover-branches-toggle').getAttribute('aria-pressed'), 'false', '命令不能切换其他图谱');
        assert.equal(app.commands.executeCommandById(id), true);
        assert.equal(second.view.contentEl.querySelector('.eg-hover-branches-toggle').getAttribute('aria-pressed'), 'false');
    } finally {
        if (hadCustomKeys) app.hotkeyManager.setHotkeys(id, originalKeys);
        else app.hotkeyManager.removeHotkeys(id);
        first.detach(); second.detach();
    }
}

function picker() {
    const modal = document.querySelector('.eg-local-node-picker');
    assert.ok(modal, '没有明确目标时应打开当前图谱节点选择器');
    return modal;
}

function choosePicker(modal, path) {
    const item = [...modal.querySelectorAll('.suggestion-item')].find(item => item.textContent.includes(path));
    assert.ok(item, `选择器应包含 ${path}`);
    item.click();
}

export async function relationsCommandTargets(plugin) {
    const { app } = plugin, files = await createFiles(app);
    const leaf = await openLocal(plugin, files[0].path, files[1].path);
    const instance = ExtendedGraphInstances.graphsManager.allInstances.get(leaf.id);
    try {
        leaf.view.renderer.onPointerOut();
        execute(app, 'expand-node-branch');
        const modal = picker();
        assert.ok(!modal.textContent.includes('outside/X.md'), '选择器不能列出当前图谱之外的文件');
        choosePicker(modal, files[1].path);
        await waitFor(() => leaf.view.renderer.nodes.some(node => node.id === files[2].path), '选择器应执行选定节点的操作');
        execute(app, 'clear-manual-branches');
        instance.nodesSet.selectNodes([leaf.view.renderer.nodes.find(node => node.id === files[1].path)]);
        execute(app, 'expand-node-branch');
        assert.equal(document.querySelector('.eg-local-node-picker'), null, '唯一选中的节点应直接执行，不再弹出选择器');
        await waitFor(() => leaf.view.renderer.nodes.some(node => node.id === files[2].path), '唯一选中节点应展开');
        instance.nodesSet.unselectNodes();
        instance.nodesSet.selectNodes([leaf.view.renderer.nodes.find(node => node.id === files[0].path)]);
        assert.equal(app.commands.findCommand('extended-graph:show-node-relations').checkCallback(true), true, '用户明确选中的中心节点也应保留现有菜单能力');
        instance.nodesSet.unselectNodes();
        await assertStalePicker(app, leaf, instance, files);
        await assertInactiveCommands(app);
    } finally {
        document.querySelector('.eg-local-node-picker .modal-close-button')?.click();
        leaf.detach();
        for (const file of files) if (app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file);
    }
}

async function assertStalePicker(app, leaf, instance, files) {
    execute(app, 'clear-manual-branches');
    instance.nodesSet.selectNodes(leaf.view.renderer.nodes.filter(node => [files[0].path, files[1].path].includes(node.id)));
    leaf.view.renderer.onPointerOut();
    execute(app, 'expand-node-branch');
    const modal = picker();
    assert.equal(instance.graphEventsDispatcher.branches.expansions.anchors.size, 0, '多选时不能猜测其中一个节点');
    await leaf.setViewState({ type: 'localgraph', state: { file: files[3].path } });
    await waitFor(() => leaf.view.file?.path === files[3].path, '应切换局部中心');
    choosePicker(modal, files[1].path);
    assert.equal(instance.graphEventsDispatcher.branches.expansions.anchors.size, 0, '旧节点选择器不能操作已更换中心的图谱');
}

async function assertInactiveCommands(app) {
    const leaf = app.workspace.getLeaf('tab');
    try {
        await leaf.openFile(app.vault.getAbstractFileByPath('notes/B.md'));
        app.workspace.setActiveLeaf(leaf, { focus: true });
        assert.equal(app.workspace.activeLeaf, leaf, '目标笔记应成为活动视图');
        assert.equal(app.commands.findCommand('extended-graph:toggle-hover-relations').checkCallback(true), false, '编辑笔记时局部图谱命令应不可用');
        const states = [...ExtendedGraphInstances.graphsManager.allInstances.values()].map(i => i.graphEventsDispatcher.branches?.enabled);
        app.commands.executeCommandById('extended-graph:toggle-hover-relations');
        assert.deepEqual([...ExtendedGraphInstances.graphsManager.allInstances.values()].map(i => i.graphEventsDispatcher.branches?.enabled), states, '编辑笔记时不能操作后台图谱');
        await leaf.setViewState({ type: 'graph', active: true });
        assert.equal(app.commands.findCommand('extended-graph:toggle-hover-relations').checkCallback(true), false, '全局图谱不适用局部命令');
    } finally {
        leaf.detach();
    }
}
