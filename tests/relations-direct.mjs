import assert from 'node:assert/strict';
import { ExtendedGraphInstances } from '../src/pluginInstances.ts';
import { RELATIONS_HOVER_SOURCE } from '../src/ui/relationsUI.ts';
import { waitFor } from './graph-fixture.mjs';

async function fixture(plugin) {
    const { app } = plugin, folder = 'relations-direct';
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
    const files = [];
    for (const [name, text] of [
        ['Root', '# 中心\n[[Target#第一段]]\n[[Target#第二段]]\n'],
        ['Target', '# 第一段\n第一段正文\n\n# 第二段\n第二段正文\n[[Ghost#临时段落]]\n'],
        ['Ghost', '# 临时段落\n临时节点正文\n'],
        ['Source', '# 引用原文\n\n引用中心：[[Root]]\n'],
    ]) files.push(await app.vault.create(`${folder}/${name}.md`, text));
    await waitFor(() => files.every(file => app.metadataCache.getFileCache(file)?.headings?.length)
        && app.metadataCache.resolvedLinks[files[0].path]?.[files[1].path]
        && app.metadataCache.resolvedLinks[files[1].path]?.[files[2].path]
        && app.metadataCache.resolvedLinks[files[3].path]?.[files[0].path], '直达预览样本应完成解析');
    const leaf = app.workspace.getLeaf('tab');
    leaf.setPinned(true);
    await leaf.setViewState({ type: 'localgraph', state: { file: files[0].path }, active: true });
    leaf.setPinned(false);
    const manager = ExtendedGraphInstances.graphsManager;
    manager.graphLeavesManager.initLeaf(leaf);
    manager.lifecycleManager.enablePlugin(leaf.view, undefined, false);
    await waitFor(() => manager.allInstances.get(leaf.id)?.graphEventsDispatcher.inputsManager, '直达预览图谱应就绪');
    return { files, leaf };
}

function altClick(leaf, path) {
    leaf.view.renderer.onNodeClick(new MouseEvent('click', { altKey: true, button: 0, clientX: 500, clientY: 350, cancelable: true }), path, '');
}

function normalTabs(app) {
    return app.workspace.getLeavesOfType('markdown').filter(leaf => !leaf.view.containerEl.closest('.hover-popover')).map(leaf => leaf.id).sort();
}

async function cleanup(plugin, leaf, files) {
    leaf.detach();
    for (const popover of [...plugin.app.plugins.plugins['hover-editor-zh']?.activePopovers ?? []]) if (!popover.isPinned) popover.hide();
    for (const tab of plugin.app.workspace.getLeavesOfType('markdown')) if (files.some(file => tab.view.file?.path === file.path)) tab.detach();
    for (const file of files) if (plugin.app.vault.getAbstractFileByPath(file.path)) await plugin.app.vault.delete(file);
}

async function assertAltDrag(leaf, path) {
    const renderer = leaf.view.renderer, canvas = renderer.interactiveEl;
    await waitFor(() => renderer.nodes.find(node => node.id === path)?.circle?.parent, '正式节点应完成绘制');
    const core = renderer.nodes.find(node => node.id === path);
    const point = core.circle.getGlobalPosition(), bounds = canvas.getBoundingClientRect(), screen = renderer.px.renderer.screen;
    const coords = { clientX: bounds.left + point.x * bounds.width / screen.width, clientY: bounds.top + point.y * bounds.height / screen.height, pointerId: 1, pointerType: 'mouse', button: 0, altKey: true, bubbles: true, cancelable: true };
    const capture = canvas.setPointerCapture;
    // 合成指针仅模拟捕获能力；实际执行宿主按下、移动及松开的分流。
    canvas.setPointerCapture = id => assert.equal(id, coords.pointerId);
    try {
        canvas.dispatchEvent(new PointerEvent('pointerdown', { ...coords, buttons: 1 }));
        assert.equal(renderer.dragNode, core, 'Alt 按住正式节点仍应进入原生拖动');
        canvas.dispatchEvent(new PointerEvent('pointermove', { ...coords, clientX: coords.clientX + 50, buttons: 1 }));
        assert.ok(Number.isFinite(core.fx) && Number.isFinite(core.fy));
        canvas.dispatchEvent(new PointerEvent('pointerup', { ...coords, clientX: coords.clientX + 50 }));
        assert.equal(leaf.view.contentEl.querySelector('.eg-relations-panel'), null, 'Alt 拖动不能打开关联面板');
    } finally {
        canvas.setPointerCapture = capture;
    }
}

export async function relationsDirect(plugin) {
    const { files, leaf } = await fixture(plugin), { app } = plugin, requests = [];
    const before = normalTabs(app);
    const ref = app.workspace.on('hover-link', request => { if (request.source === RELATIONS_HOVER_SOURCE) requests.push(request); });
    try {
        await assertAltDrag(leaf, files[1].path);
        assert.equal(requests.length, 0, 'Alt 拖动不能发出预览请求');
        assert.equal(leaf.view.contentEl.querySelector('.eg-hover-branches-toggle').getAttribute('aria-pressed'), 'false');
        altClick(leaf, files[1].path);
        await waitFor(() => requests.length > 0, 'Alt 单击应直接触发精确浮窗，不再经过菜单和二次悬浮');
        assert.equal(requests[0].linktext, files[1].path + '#第一段');
        assert.deepEqual(normalTabs(app), before, 'Alt 单击不能打开普通笔记标签页');
        const panel = leaf.view.contentEl.querySelector('.eg-relations-panel');
        assert.equal(panel.querySelectorAll('.eg-relations-group').length, 2, '首处自动预览时应保留全部位置');
        panel.querySelectorAll('.eg-relations-target')[1].click();
        await waitFor(() => requests.length === 2, '直达模式单击其他位置应切换浮窗');
        assert.equal(requests[1].linktext, files[1].path + '#第二段');
        assert.deepEqual(normalTabs(app), before);
        assert.equal(leaf.view.file.path, files[0].path, '浮窗聚焦不能改变局部中心');
        panel.querySelectorAll('.eg-relations-target')[1].dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true }));
        await waitFor(() => app.workspace.getLeavesOfType('markdown').some(tab => !tab.view.containerEl.closest('.hover-popover') && tab.view.file?.path === files[1].path), 'Ctrl 点击应保留普通标签页打开能力');
        assert.equal(requests.length, 2, 'Ctrl 点击不能再次发出浮窗请求');
        panel.querySelector('.eg-relations-close').click();
        assert.equal(leaf.pinned, false, '关闭后应释放临时固定');
    } finally {
        app.workspace.offref(ref);
        await cleanup(plugin, leaf, files);
    }
}

export async function relationsDirectSource(plugin) {
    const { files, leaf } = await fixture(plugin), { app } = plugin, requests = [];
    const ref = app.workspace.on('hover-link', request => { if (request.source === RELATIONS_HOVER_SOURCE) requests.push(request); });
    try {
        altClick(leaf, files[3].path);
        await waitFor(() => requests.length > 0, '整篇反向链接也应直达引用原文');
        assert.equal(requests[0].linktext, files[3].path, '没有目标段落时应显示来源笔记，而非猜测中心段落');
        assert.equal(requests[0].state.line, 2, '来源引用应保留精确行号');
        assert.equal(requests[0].state.startLoc.line, 2);
    } finally {
        app.workspace.offref(ref);
        await cleanup(plugin, leaf, files);
    }
}

async function showBranch(leaf, path) {
    leaf.view.renderer.onNodeHover(new MouseEvent('mousemove', { clientX: 500, clientY: 350 }), path, '');
    await waitFor(() => leaf.view.renderer.hanger.children.find(child => child.name === 'eg-branch-layer')?.alpha > 0.9, '临时层应完成淡入');
}

export async function relationsDirectBranches(plugin, width) {
    const { files, leaf } = await fixture(plugin), { app } = plugin, requests = [];
    const ref = app.workspace.on('hover-link', request => { if (request.source === RELATIONS_HOVER_SOURCE) requests.push(request); });
    try {
        if (width) { leaf.view.contentEl.style.width = width + 'px'; leaf.view.renderer.onResize(); }
        leaf.view.contentEl.querySelector('.eg-hover-branches-toggle').click();
        await showBranch(leaf, files[1].path);
        leaf.view.contentEl.querySelector(`.eg-branch-preview g[data-path="${files[2].path}"]`)
            .dispatchEvent(new MouseEvent('click', { altKey: true, button: 0, bubbles: true, cancelable: true }));
        await waitFor(() => requests.length === 1, '小图 Alt 单击应直接预览真实父节点的引用');
        assert.equal(requests[0].linktext, files[2].path + '#临时段落');
        const panel = leaf.view.contentEl.querySelector('.eg-relations-panel');
        assert.equal(panel.dataset.center, files[1].path, '临时节点应使用实际连接两端，而非无引用的根中心');
        assert.equal(panel.dataset.neighbor, files[2].path);
        panel.querySelector('.eg-relations-close').click();
        await showBranch(leaf, files[1].path);
        const renderer = leaf.view.renderer, canvas = renderer.interactiveEl;
        const layer = renderer.hanger.children.find(child => child.name === 'eg-branch-layer');
        const ghost = layer.children.find(child => child.name === `eg-branch-node:${files[2].path}`);
        const bounds = canvas.getBoundingClientRect(), screen = renderer.px.renderer.screen;
        const point = ghost.getGlobalPosition();
        const coords = { clientX: bounds.left + point.x * bounds.width / screen.width, clientY: bounds.top + point.y * bounds.height / screen.height, pointerId: 1, pointerType: 'mouse', button: 0, altKey: true, bubbles: true, cancelable: true };
        canvas.dispatchEvent(new PointerEvent('pointerdown', { ...coords, buttons: 1 }));
        canvas.dispatchEvent(new PointerEvent('pointermove', { ...coords, buttons: 1, clientX: coords.clientX + 40 }));
        canvas.dispatchEvent(new PointerEvent('pointerup', { ...coords, clientX: coords.clientX + 40 }));
        assert.equal(requests.length, 1, 'Alt 拖动临时节点不能触发预览');
        canvas.dispatchEvent(new PointerEvent('pointerdown', { ...coords, clientX: coords.clientX + 40, buttons: 1 }));
        canvas.dispatchEvent(new PointerEvent('pointerup', { ...coords, clientX: coords.clientX + 40 }));
        await waitFor(() => requests.length === 2, '主图临时节点 Alt 单击应在松开后预览');
        assert.equal(requests[1].linktext, files[2].path + '#临时段落');
        assert.equal(leaf.view.file.path, files[0].path);
    } finally {
        app.workspace.offref(ref);
        await cleanup(plugin, leaf, files);
    }
}

export async function relationsDirectRace(plugin) {
    const { files, leaf } = await fixture(plugin), { app } = plugin, requests = [];
    const original = app.vault.cachedRead;
    let delayed = false;
    const ref = app.workspace.on('hover-link', request => { if (request.source === RELATIONS_HOVER_SOURCE) requests.push(request); });
    app.vault.cachedRead = async function (file) {
        if (file === files[0] && !delayed) { delayed = true; await new Promise(resolve => setTimeout(resolve, 80)); }
        return original.call(this, file);
    };
    try {
        altClick(leaf, files[1].path);
        altClick(leaf, files[3].path);
        await waitFor(() => requests.length > 0, '连续点击应预览最后的节点');
        await new Promise(resolve => setTimeout(resolve, 120));
        assert.equal(requests.length, 1, '旧读取完成后不能再弹出旧节点');
        assert.equal(requests[0].linktext, files[3].path);
        app.vault.cachedRead = original;
        leaf.view.contentEl.querySelector('.eg-relations-close').click();
        await assertRefreshRace(app, leaf, files, requests);
    } finally {
        app.vault.cachedRead = original;
        app.workspace.offref(ref);
        await cleanup(plugin, leaf, files);
    }
}

async function assertRefreshRace(app, leaf, files, requests) {
    const original = app.vault.cachedRead;
    let reads = 0, release;
    const pending = new Promise(resolve => { release = resolve; });
    app.vault.cachedRead = async function (file) {
        if (file === files[0] && ++reads === 2) await pending;
        return original.call(this, file);
    };
    try {
        altClick(leaf, files[1].path);
        await waitFor(() => reads === 2, '首处定位再次校验时暂停读取');
        await app.vault.modify(files[0], await original.call(app.vault, files[0]) + '\n');
        await waitFor(() => reads > 2, '元数据刷新应重新读取关系');
        await waitFor(() => requests.length === 2, '首次定位被刷新取消后，新面板仍须自动预览');
        assert.equal(requests[1].linktext, files[1].path + '#第一段');
        release();
        await new Promise(resolve => setTimeout(resolve, 80));
        assert.equal(requests.length, 2, '旧定位恢复后不能重复弹窗');
    } finally {
        release();
        app.vault.cachedRead = original;
    }
}
