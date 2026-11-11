import assert from 'node:assert/strict';
import { Menu } from 'obsidian';
import { ExtendedGraphInstances } from '../src/pluginInstances.ts';
import { waitFor } from './graph-fixture.mjs';
import { RadialMenuManager } from '../src/ui/radialMenu.ts';

async function createFixture(app) {
    const root = 'branches-ui';
    if (!app.vault.getAbstractFileByPath(root)) await app.vault.createFolder(root);
    const files = [];
    for (const [name, text] of [['Root', '# 中心\n[[A]] [[D]]\n'], ['A', '# 甲\n[[B#目标]]\n'], ['B', '# 目标\n[[C]]\n'], ['C', '# 丙\n'], ['D', '# 丁\n[[B]]\n']]) {
        files.push(await app.vault.create(`${root}/${name}.md`, text));
    }
    await waitFor(() => files.every(file => app.metadataCache.getFileCache(file)?.headings?.length), '分支样本应完成索引');
    return files;
}

async function openFixture(plugin, files) {
    const leaf = plugin.app.workspace.getLeaf('tab');
    leaf.setPinned(true);
    await leaf.setViewState({ type: 'localgraph', state: { file: files[0].path }, active: true });
    await waitFor(() => leaf.view.renderer?.nodes.some(node => node.id === files[1].path), '主图应就绪');
    leaf.setPinned(false);
    const manager = ExtendedGraphInstances.graphsManager;
    manager.graphLeavesManager.initLeaf(leaf);
    manager.lifecycleManager.enablePlugin(leaf.view, undefined, false);
    await waitFor(() => manager.allInstances.get(leaf.id)?.graphEventsDispatcher.inputsManager, '图谱增强应就绪');
    return leaf;
}

function chooseMenu(plugin, leaf, file, label) {
    const menu = new Menu();
    ExtendedGraphInstances.graphsManager.onNodeMenuOpened(menu, file, 'graph-context-menu', leaf);
    menu.showAtPosition({ x: 100, y: 100 });
    const entry = [...menu.dom.querySelectorAll('.menu-item')].find(item => item.textContent.trim().includes(label));
    assert.ok(entry, `节点菜单应有 ${label}`);
    entry.click();
    menu.hide();
}

export async function branchesExplore(plugin) {
    const files = await createFixture(plugin.app);
    const leaf = await openFixture(plugin, files);
    try {
        const toggle = leaf.view.contentEl.querySelector('.eg-hover-branches-toggle');
        toggle.click();
        leaf.view.renderer.onNodeHover(new MouseEvent('mousemove', { clientX: 500, clientY: 350 }), files[1].path, '');
        await waitFor(() => leaf.view.contentEl.querySelector('.eg-branch-preview:not([hidden])')?.dataset.anchor === files[1].path, '应显示甲邻域');
        await assertRecursive(leaf, files);
        await assertManual(plugin, leaf, files);
        await assertNativePreview(plugin, leaf, files);
    } finally {
        leaf.detach();
        for (const file of files) if (plugin.app.vault.getAbstractFileByPath(file.path)) await plugin.app.vault.delete(file);
    }
}

export async function branchesHit(plugin, width) {
    const files = await createFixture(plugin.app);
    const leaf = await openFixture(plugin, files);
    const originalLeaves = new Set(plugin.app.workspace.getLeavesOfType('markdown').map(item => item.id));
    try {
        if (width) { leaf.view.contentEl.style.width = width + 'px'; leaf.view.renderer.onResize(); }
        leaf.view.contentEl.querySelector('.eg-hover-branches-toggle').click();
        leaf.view.renderer.onNodeHover(new MouseEvent('mousemove', { clientX: 500, clientY: 350 }), files[1].path, '');
        await waitFor(() => leaf.view.contentEl.querySelector('.eg-branch-preview:not([hidden])'), '应显示预览');
        await waitFor(() => leaf.view.renderer.hanger.children.find(child => child.name === 'eg-branch-layer')?.alpha > 0.9, '临时层应完成淡入');
        const layer = leaf.view.renderer.hanger.children.find(child => child.name === 'eg-branch-layer');
        const ghost = layer.children.find(child => child.name === `eg-branch-node:${files[2].path}`);
        const point = ghost.getGlobalPosition(), canvas = leaf.view.renderer.interactiveEl;
        const bounds = canvas.getBoundingClientRect(), screen = leaf.view.renderer.px.renderer.screen;
        const coords = { clientX: bounds.left + point.x * bounds.width / screen.width, clientY: bounds.top + point.y * bounds.height / screen.height, bubbles: true, cancelable: true, pointerType: 'mouse' };
        const parent = layer.children.find(child => child.name === `eg-branch-node:${files[1].path}`).getGlobalPosition();
        canvas.dispatchEvent(new PointerEvent('pointerdown', {
            ...coords, button: 2,
            clientX: bounds.left + (parent.x + point.x) * bounds.width / screen.width / 2,
            clientY: bounds.top + (parent.y + point.y) * bounds.height / screen.height / 2,
        }));
        await waitFor(() => leaf.view.contentEl.querySelector('.eg-relations-panel')?.dataset.center === files[1].path, '主图临时边右键应打开其真实两端的引用');
        leaf.view.contentEl.querySelector('.eg-relations-close').click();
        canvas.dispatchEvent(new PointerEvent('pointerdown', { ...coords, button: 2 }));
        const context = new MouseEvent('contextmenu', { ...coords, button: 2 });
        canvas.dispatchEvent(context);
        assert.equal(context.defaultPrevented, true, '临时节点右键不能再触发底层图谱菜单');
        await waitFor(() => leaf.view.contentEl.querySelector('.eg-relations-panel')?.dataset.center === files[1].path, '临时节点右键应使用实际父节点而非图谱中心');
        assert.equal(leaf.view.contentEl.querySelector('.eg-relations-panel').dataset.neighbor, files[2].path);
        leaf.view.contentEl.querySelector('.eg-relations-close').click();
        canvas.dispatchEvent(new PointerEvent('pointerdown', { ...coords, button: 0 }));
        canvas.dispatchEvent(new PointerEvent('pointerup', { ...coords, button: 0 }));
        await waitFor(() => plugin.app.workspace.getLeavesOfType('markdown').some(item => !originalLeaves.has(item.id) && item.view.file?.path === files[2].path), '点击主图临时节点应打开笔记而不是开始拖图');
    } finally {
        leaf.detach();
        for (const item of plugin.app.workspace.getLeavesOfType('markdown')) if (!originalLeaves.has(item.id)) item.detach();
        for (const file of files) if (plugin.app.vault.getAbstractFileByPath(file.path)) await plugin.app.vault.delete(file);
    }
}

async function assertRecursive(leaf, files) {
    const panel = leaf.view.contentEl.querySelector('.eg-branch-preview');
    const layer = leaf.view.renderer.hanger.children.find(child => child.name === 'eg-branch-layer');
    const ghost = layer.children.find(child => child.name === `eg-branch-node:${files[2].path}`);
    const previous = { x: ghost.x, y: ghost.y };
    const beforeBounds = panel.getBoundingClientRect();
    panel.dispatchEvent(new PointerEvent('pointerenter'));
    leaf.view.renderer.onNodeUnhover();
    panel.querySelector(`g[data-path="${files[2].path}"]`).dispatchEvent(new MouseEvent('pointerenter', { clientX: 500, clientY: 350 }));
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(panel.dataset.anchor, files[1].path, '重绘后鼠标未移动时不能自动进入下一层');
    panel.querySelector(`g[data-path="${files[2].path}"]`).dispatchEvent(new MouseEvent('pointerenter', { clientX: 550, clientY: 370 }));
    await waitFor(() => panel.dataset.anchor === files[2].path, '小图中新节点应继续显示下一层');
    const afterBounds = panel.getBoundingClientRect();
    assert.ok(Math.abs(beforeBounds.left - afterBounds.left) < 2 && Math.abs(beforeBounds.top - afterBounds.top) < 2, '递归探索时小图位置应保持稳定');
    const nextLayer = leaf.view.renderer.hanger.children.find(child => child.name === 'eg-branch-layer');
    const nextGhost = nextLayer.children.find(child => child.name === `eg-branch-node:${files[2].path}`);
    assert.ok(Math.hypot(nextGhost.x - previous.x, nextGhost.y - previous.y) < 60, '递归进入临时节点不能跳回原点');
    assert.ok(panel.querySelector(`g[data-path="${files[3].path}"]`), '下一层应显示丙');
    assert.equal(leaf.view.renderer.nodes.some(node => node.id === files[3].path), false, '递归预览仍不能写入核心图');
    panel.dispatchEvent(new PointerEvent('pointerleave'));
    await waitFor(() => panel.hidden, '离开联合区域后应淡出并清理');
}

async function assertManual(plugin, leaf, files) {
    const manager = ExtendedGraphInstances.graphsManager;
    const radial = new RadialMenuManager(manager.allInstances.get(leaf.id), files[1].path, '');
    const branchMenu = radial.allItems.find(item => item.id === 'branches');
    assert.ok(branchMenu?.items?.some(item => item.title === '展开一层'), '圆形菜单应提供展开一层');
    assert.ok(branchMenu.items.some(item => item.title === '收起所有手动分支'), '圆形菜单应提供全部收起');
    assert.ok(branchMenu.items.some(item => item.title === '切换来源关联'), '圆形菜单应提供来源开关');
    radial.menu.hide();
    chooseMenu(plugin, leaf, files[1], '展开一层');
    await waitFor(() => leaf.view.renderer.nodes.some(node => node.id === files[2].path), '手动展开应把乙加入核心图');
    await waitFor(() => manager.allInstances.get(leaf.id).nodesSet.extendedElementsMap.has(files[2].path), '手动节点应由原有增强接管');
    chooseMenu(plugin, leaf, files[4], '展开一层');
    chooseMenu(plugin, leaf, files[1], '收起这一层');
    await waitFor(() => leaf.view.renderer.nodes.some(node => node.id === files[2].path), '另一分支仍使用乙时应保留');
    chooseMenu(plugin, leaf, files[4], '收起这一层');
    await waitFor(() => !leaf.view.renderer.nodes.some(node => node.id === files[2].path), '全部所有者收起后移除独占节点');
}

async function assertNativePreview(plugin, leaf, files) {
    const events = [];
    const ref = plugin.app.workspace.on('hover-link', event => { if (event.source === 'graph') events.push(event); });
    try {
        const event = new MouseEvent('mousemove', { ctrlKey: true, clientX: 500, clientY: 350 });
        leaf.view.renderer.onNodeHover(event, files[1].path, '');
        await waitFor(() => events.length === 1, 'Ctrl 悬浮应转交原有笔记预览');
        assert.equal(leaf.view.file.path, files[0].path, '笔记预览不能改变中心');
        leaf.view.renderer.onNodeUnhover();
        leaf.view.contentEl.querySelector('.eg-hover-branches-toggle').click();
        leaf.view.renderer.onNodeHover(new MouseEvent('mousemove'), files[1].path, '');
        await waitFor(() => events.length === 2, '关闭后普通悬浮应恢复原预览');
    } finally {
        plugin.app.workspace.offref(ref);
    }
}

export async function branchesHover(plugin) {
    const { app } = plugin;
    const files = await createFixture(app);
    const leaf = app.workspace.getLeaf('tab');
    try {
        leaf.setPinned(true);
        await leaf.setViewState({ type: 'localgraph', state: { file: files[0].path }, active: true });
        await waitFor(() => leaf.view.renderer?.nodes.some(node => node.id === files[1].path), '主图应显示第一层甲节点');
        leaf.setPinned(false);
        const manager = ExtendedGraphInstances.graphsManager;
        manager.graphLeavesManager.initLeaf(leaf);
        manager.lifecycleManager.enablePlugin(leaf.view, undefined, false);
        await waitFor(() => manager.allInstances.get(leaf.id)?.graphEventsDispatcher.inputsManager, '增强局部图谱应就绪');
        leaf.view.headerEl.style.display = 'none';
        const toggle = leaf.view.contentEl.querySelector('.eg-hover-branches-toggle');
        assert.ok(toggle?.closest('.eg-local-tools'), '隐藏标题栏时，图谱右上角工具栏仍应有独立开关');
        const controls = leaf.view.contentEl.querySelector('.graph-controls');
        if (!controls.classList.contains('is-close')) controls.querySelector('.mod-close')?.click();
        assert.ok(toggle.getBoundingClientRect().width > 0, '收起设置后开关仍应可见');
        assert.equal(toggle.textContent.trim(), '', '悬浮关联开关应只显示图标');
        assert.ok(toggle.querySelector('svg'), '图标开关应保留网络图标');
        assert.ok(toggle.getAttribute('aria-label').includes('悬浮关联'), '图标开关仍应有可访问提示');
        assert.equal(toggle.getAttribute('aria-pressed'), 'false');
        const before = leaf.view.renderer.nodes.map(node => node.id).sort();
        toggle.click();
        assert.equal(toggle.getAttribute('aria-pressed'), 'true');
        leaf.view.renderer.onNodeHover(new MouseEvent('mousemove', { clientX: 500, clientY: 350 }), files[1].path, '');
        await waitFor(() => leaf.view.contentEl.querySelector('.eg-branch-preview:not([hidden])')?.dataset.anchor === files[1].path, '悬浮后应显示甲的一层关联小图');
        assert.deepEqual(leaf.view.renderer.nodes.map(node => node.id).sort(), before, '临时预览不得注入核心节点');
        assert.ok(leaf.view.renderer.hanger.children.some(child => child.name === 'eg-branch-layer' && child.visible), '主图应同步显示临时层');
        const instance = manager.allInstances.get(leaf.id);
        const originalIgnore = instance.settings.ignoreInlineLinks;
        const originalFolders = instance.settings.excludedTargetsFolder;
        const originalLinks = instance.settings.enableFeatures.localgraph.links;
        instance.settings.ignoreInlineLinks = true;
        instance.graphEventsDispatcher.branches.refreshData();
        assert.equal(leaf.view.contentEl.querySelector('.eg-branch-preview').dataset.total, '0', '忽略正文链接时临时预览应复用正式边筛选');
        instance.settings.ignoreInlineLinks = originalIgnore;
        instance.settings.enableFeatures.localgraph.links = true;
        instance.settings.excludedTargetsFolder = ['branches-ui/'];
        instance.graphEventsDispatcher.branches.refreshData();
        assert.equal(leaf.view.contentEl.querySelector('.eg-branch-preview').dataset.total, '0', '排除目标目录时临时边应同步隐藏');
        instance.settings.excludedTargetsFolder = originalFolders;
        instance.settings.enableFeatures.localgraph.links = originalLinks;
        instance.graphEventsDispatcher.branches.refreshData();
        toggle.click();
        assert.equal(leaf.view.contentEl.querySelector('.eg-branch-preview:not([hidden])'), null, '关闭开关应清理临时预览');
        assert.equal(leaf.pinned, false, '关闭后应恢复原固定状态');
    } finally {
        leaf.detach();
        for (const file of files) if (app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file);
    }
}

export async function branchesDrag(plugin, width) {
    const files = await createFixture(plugin.app);
    const leaf = await openFixture(plugin, files);
    const before = new Set(plugin.app.workspace.getLeavesOfType('markdown').map(item => item.id));
    try {
        if (width) { leaf.view.contentEl.style.width = width + 'px'; leaf.view.renderer.onResize(); }
        const renderer = leaf.view.renderer, canvas = renderer.interactiveEl;
        leaf.view.contentEl.querySelector('.eg-hover-branches-toggle').click();
        renderer.onNodeHover(new MouseEvent('mousemove', { clientX: 500, clientY: 350 }), files[1].path, '');
        await waitFor(() => renderer.hanger.children.find(child => child.name === 'eg-branch-layer')?.alpha > 0.9, '拖动前预览应显示');
        const core = renderer.nodes.find(node => node.id === files[1].path);
        const point = core.circle.getGlobalPosition(), bounds = canvas.getBoundingClientRect(), screen = renderer.px.renderer.screen;
        const coords = { clientX: bounds.left + point.x * bounds.width / screen.width, clientY: bounds.top + point.y * bounds.height / screen.height, bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1, button: 0 };
        assertNativeDrag(renderer, core, coords);
        assert.equal(plugin.app.workspace.getLeavesOfType('markdown').some(item => !before.has(item.id)), false, '拖动正式节点不能打开笔记');
        await assertGhostDrag(plugin, leaf, files, before);
    } finally {
        leaf.detach();
        for (const item of plugin.app.workspace.getLeavesOfType('markdown')) if (!before.has(item.id)) item.detach();
        for (const file of files) if (plugin.app.vault.getAbstractFileByPath(file.path)) await plugin.app.vault.delete(file);
    }
}

function assertNativeDrag(renderer, core, coords) {
    const canvas = renderer.interactiveEl, originalCapture = canvas.setPointerCapture;
    // 合成事件没有浏览器活动指针，仅模拟捕获能力；拖动和点击判断仍执行宿主正式事件。
    canvas.setPointerCapture = pointerId => assert.equal(pointerId, coords.pointerId);
    try {
        const down = new PointerEvent('pointerdown', { ...coords, buttons: 1 });
        canvas.dispatchEvent(down);
        assert.equal(down.defaultPrevented, false, '临时边端点不能抢走正式节点的原生拖动');
        assert.equal(renderer.dragNode, core, '按住正式节点应进入宿主拖动');
        canvas.dispatchEvent(new PointerEvent('pointermove', { ...coords, buttons: 1, clientX: coords.clientX + 50 }));
        assert.ok(Number.isFinite(core.fx) && Number.isFinite(core.fy), '原生移动事件应真正更新节点拖动坐标');
        canvas.dispatchEvent(new PointerEvent('pointerup', { ...coords, clientX: coords.clientX + 50 }));
    } finally {
        canvas.setPointerCapture = originalCapture;
    }
}

async function ghostPointer(leaf, files) {
    const renderer = leaf.view.renderer;
    renderer.onNodeHover(new MouseEvent('mousemove', { clientX: 500, clientY: 350 }), files[1].path, '');
    await waitFor(() => renderer.hanger.children.find(child => child.name === 'eg-branch-layer')?.alpha > 0.9, '临时节点应完成淡入');
    const layer = renderer.hanger.children.find(child => child.name === 'eg-branch-layer');
    const ghost = layer.children.find(child => child.name === `eg-branch-node:${files[2].path}`);
    const point = ghost.getGlobalPosition(), bounds = renderer.interactiveEl.getBoundingClientRect(), screen = renderer.px.renderer.screen;
    return { ghost, coords: { clientX: bounds.left + point.x * bounds.width / screen.width, clientY: bounds.top + point.y * bounds.height / screen.height, bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1, button: 0 } };
}

async function assertGhostDrag(plugin, leaf, files, before) {
    const canvas = leaf.view.renderer.interactiveEl;
    const opened = () => plugin.app.workspace.getLeavesOfType('markdown').some(item => !before.has(item.id));
    const { ghost, coords } = await ghostPointer(leaf, files);
    const start = ghost.getGlobalPosition();
    const label = leaf.view.renderer.nodes[0].text;
    assert.equal(label.eventMode, 'none', '重叠样本应使用原生非交互标签');
    const saved = { x: label.x, y: label.y, anchorX: label.anchor.x, anchorY: label.anchor.y };
    label.position.copyFrom(label.parent.toLocal(start));
    label.anchor.set(0.5, 0.5);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...coords, buttons: 1 }));
    label.position.set(saved.x, saved.y);
    label.anchor.set(saved.anchorX, saved.anchorY);
    assert.equal(leaf.view.contentEl.querySelector('.eg-branch-preview').hidden, false, '非交互的正式节点标签不能抢走重叠的临时节点拖动');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(opened(), false, '临时节点按下时不得立即打开笔记');
    canvas.dispatchEvent(new PointerEvent('pointermove', { ...coords, buttons: 1, clientX: coords.clientX + 50, clientY: coords.clientY + 30 }));
    const moved = ghost.getGlobalPosition();
    assert.ok(Math.hypot(moved.x - start.x, moved.y - start.y) > 20, '拖动应实际移动临时节点');
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...coords, clientX: coords.clientX + 50, clientY: coords.clientY + 30 }));
    assert.equal(opened(), false, '移动后松开临时节点不能打开笔记');
    assert.equal(leaf.view.renderer.nodes.some(node => node.id === files[2].path), false, '临时拖动不能注入核心节点');
    await assertGhostCancellation(leaf, files, opened);
    const click = await ghostPointer(leaf, files);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...click.coords, buttons: 1 }));
    assert.equal(opened(), false);
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...click.coords, clientX: click.coords.clientX + 2 }));
    await waitFor(opened, '未越过拖动阈值的单击应在松开后打开笔记');
}

async function assertGhostCancellation(leaf, files, opened) {
    const canvas = leaf.view.renderer.interactiveEl;
    const next = await ghostPointer(leaf, files);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...next.coords, buttons: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointercancel', next.coords));
    canvas.dispatchEvent(new PointerEvent('pointerup', next.coords));
    assert.equal(opened(), false, '取消的拖动不能打开笔记');
    assert.ok(leaf.view.contentEl.querySelector('.eg-branch-preview').hidden, '取消拖动应清理预览');
    assert.equal(leaf.pinned, false, '取消拖动应释放中心固定');
    const outside = await ghostPointer(leaf, files);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...outside.coords, buttons: 1 }));
    canvas.win.dispatchEvent(new PointerEvent('pointerup', { ...outside.coords, clientX: canvas.getBoundingClientRect().right + 20 }));
    assert.ok(leaf.view.contentEl.querySelector('.eg-branch-preview').hidden, '移出图谱后松开应清理拖动和预览');
    assert.equal(opened(), false, '图谱外松开不能打开笔记');
    assert.equal(leaf.pinned, false);
}

export async function branchesIsolation(plugin) {
    const files = await createFixture(plugin.app);
    const first = await openFixture(plugin, files);
    const second = await openFixture(plugin, files);
    const manager = ExtendedGraphInstances.graphsManager;
    try {
        const renderer = first.view.renderer;
        const controller = manager.allInstances.get(first.id).graphEventsDispatcher.branches;
        first.view.contentEl.querySelector('.eg-hover-branches-toggle').click();
        assert.equal(second.view.contentEl.querySelector('.eg-hover-branches-toggle').getAttribute('aria-pressed'), 'false', '两个局部视图应有独立开关');
        renderer.onNodeHover(new MouseEvent('mousemove', { clientX: 500, clientY: 350 }), files[1].path, '');
        await waitFor(() => first.view.contentEl.querySelector('.eg-branch-preview:not([hidden])'), '第一视图应出现预览');
        assert.equal(second.view.contentEl.querySelector('.eg-branch-preview:not([hidden])'), null);
        assert.equal(first.pinned, true, '预览期间应固定第一视图中心');
        assert.equal(second.pinned, false, '第二视图固定状态不能改变');
        renderer.destroyGraphics();
        renderer.initGraphics();
        chooseMenu(plugin, first, files[1], '展开一层');
        await waitFor(() => manager.allInstances.get(first.id).nodesSet.extendedElementsMap.has(files[2].path), '绘图重建期间展开的新节点应在恢复后接管');
        await plugin.app.vault.delete(files[1]);
        await waitFor(() => !controller.expansions.anchors.has(files[1].path), '删除展开的锚点应删除其分支所有权');
        files[1] = await plugin.app.vault.create(files[1].path, '# 甲\n[[B#目标]]\n');
        assert.equal(controller.expansions.anchors.has(files[1].path), false, '重建同路径文件不能复活旧分支');
        chooseMenu(plugin, first, files[1], '展开一层');
        await first.setViewState({ type: 'localgraph', state: { file: files[4].path } });
        await waitFor(() => first.view.file?.path === files[4].path && controller.expansions.anchors.size === 0, '主动更换中心应清理手动分支');
        assert.equal(first.view.contentEl.querySelector('.eg-branch-preview:not([hidden])'), null, '换中心应关闭旧预览');
        assert.equal(first.pinned, false, '换中心后应释放临时固定');
        const originalHover = renderer.onNodeHover;
        renderer.onNodeHover(new MouseEvent('mousemove'), files[2].path, '');
        first.detach();
        await new Promise(resolve => setTimeout(resolve, 500));
        assert.notEqual(renderer.onNodeHover, originalHover, '关闭视图应撤销本实例悬浮包装');
        assert.equal(controller.expansions.anchors.size, 0);
        assert.equal(plugin.app.workspace.containerEl.querySelector(`.eg-branch-preview[data-anchor="${files[2].path}"]`), null, '关闭后的延迟任务不能重建预览');
    } finally {
        if (first.parent) first.detach();
        second.detach();
        for (const file of files) if (plugin.app.vault.getAbstractFileByPath(file.path)) await plugin.app.vault.delete(file);
    }
}
