import assert from 'node:assert/strict';
import { appearanceFixture, showAppearance } from './graph-appearance.mjs';
import { cleanPolish } from './relations-polish.mjs';
import { waitFor } from './graph-fixture.mjs';
import { branchesHit, branchesDrag } from './branches-ui.mjs';
import { relationsDirectBranches } from './relations-direct.mjs';

function assertFloatingCanvas(area, mini, renderer, original) {
    assert.ok(mini.classList.contains('is-floating'), '宽窗也应使用可拖动浮窗');
    const canvas = renderer.interactiveEl.getBoundingClientRect(), preview = mini.getBoundingClientRect();
    assert.ok(Math.abs(canvas.width - original.before) < 1, '开启预览不能压缩主图画布');
    assert.equal(area.classList.contains('eg-preview-reserved'), false, '图谱不能进入停靠布局');
    assert.equal(area.querySelector('.eg-preview-rail, .eg-preview-viewport'), null, '不能创建停靠占位');
    assert.ok(Math.abs(renderer.width - canvas.width) < 2, '宿主画布逻辑宽度应与实际点击区域一致');
    assert.ok(Math.abs(renderer.px.renderer.screen.width / window.devicePixelRatio - canvas.width) < 2, 'Pixi 分辨率应同步实际宽度');
    assert.equal(renderer.iframeEl.contentDocument, original.frameDocument, '预览不能重载 iframe 内的 WebGL 环境');
    assert.equal(renderer.containerEl, original.container, '预览不能替换宿主画布容器');
    return { canvas, preview };
}

function dragPreview(mini, dx, dy = 0) {
    const bounds = mini.getBoundingClientRect(), win = mini.ownerDocument.defaultView;
    const start = { clientX: bounds.left + 40, clientY: bounds.top + 12, pointerId: 73, button: 0, bubbles: true, cancelable: true };
    mini.querySelector('.eg-branch-preview-header').dispatchEvent(new PointerEvent('pointerdown', start));
    win.dispatchEvent(new PointerEvent('pointermove', { ...start, clientX: start.clientX + dx, clientY: start.clientY + dy }));
    win.dispatchEvent(new PointerEvent('pointerup', { ...start, clientX: start.clientX + dx, clientY: start.clientY + dy }));
    return mini.getBoundingClientRect();
}

export async function previewFloatingLayout(plugin) {
    const fixture = await appearanceFixture(plugin), { leaf } = fixture;
    const area = leaf.view.contentEl, original = area.getAttribute('style'), renderer = leaf.view.renderer;
    const container = renderer.containerEl, frameDocument = renderer.iframeEl.contentDocument;
    try {
        area.style.width = '1000px';
        renderer.onResize();
        const before = renderer.interactiveEl.getBoundingClientRect().width;
        const mini = await showAppearance(fixture);
        const { canvas, preview } = assertFloatingCanvas(area, mini, renderer, { before, container, frameDocument });
        area.style.width = '950px';
        renderer.onResize();
        await waitFor(() => renderer.width === 950, '宽窗缩放仍由宿主控制完整画布');
        area.style.width = '1000px';
        renderer.onResize();
        await waitFor(() => renderer.width === 1000, '恢复宽度后仍使用完整画布');
        const width = canvas.width, left = preview.left;
        renderer.onNodeUnhover(); mini.dispatchEvent(new PointerEvent('pointerleave'));
        await waitFor(() => mini.hidden, '离开应收起临时内容');
        assert.ok(Math.abs(renderer.interactiveEl.getBoundingClientRect().width - width) < 1, '暂时离开不能反复改变主图尺寸');
        await showAppearance(fixture);
        assert.ok(Math.abs(mini.getBoundingClientRect().left - left) < 1, '重新悬浮应留在原位置');
        area.style.width = '600px';
        renderer.onResize();
        await waitFor(() => renderer.width === 600, '窄窗也应使用完整画布');
        area.style.width = '1000px';
        renderer.onResize();
        await waitFor(() => renderer.width === 1000 && mini.classList.contains('is-floating'), '变宽仍应保留浮窗');
        area.querySelector('.eg-hover-branches-toggle').click();
        await waitFor(() => Math.abs(renderer.interactiveEl.getBoundingClientRect().width - before) < 2, '关闭悬浮开关应恢复完整画布');
        assert.equal(renderer.containerEl, container, '关闭后应还原宿主原始容器引用');
        await showAppearance(fixture);
        const manager = plugin._children.find(child => child.allInstances);
        manager.lifecycleManager.disablePlugin(leaf.view);
        assert.equal(renderer.containerEl, container, '停用当前图谱增强也应恢复原始容器');
        assert.equal(area.querySelector('.eg-preview-rail'), null, '停用后不能遗留停靠占位');
    } finally {
        if (original === null) area.removeAttribute('style'); else area.setAttribute('style', original);
        await cleanPolish(fixture);
    }
}

export async function previewFloatingInteractions(plugin) {
    await branchesHit(plugin, 1000);
    await branchesDrag(plugin, 1000);
    await relationsDirectBranches(plugin, 1000);
}

export async function previewFloatDrag(plugin) {
    const fixture = await appearanceFixture(plugin), { leaf, files } = fixture;
    const area = leaf.view.contentEl, original = area.getAttribute('style');
    try {
        area.style.width = '600px';
        leaf.view.renderer.onResize();
        const mini = await showAppearance(fixture);
        await waitFor(() => mini.classList.contains('is-floating'), '应提供可拖动浮窗');
        const initial = mini.getBoundingClientRect(), moved = dragPreview(mini, -90, 28);
        assert.ok(moved.left < initial.left - 50, '拖动标题栏应能移动浮窗');
        mini.querySelector(`g[data-path="${files[2].path}"]`).dispatchEvent(new MouseEvent('pointerenter', { clientX: 560, clientY: 390 }));
        await waitFor(() => mini.dataset.anchor === files[2].path, '浮窗仍可递归探索');
        assert.ok(Math.abs(mini.getBoundingClientRect().left - moved.left) < 2, '进入下一层不能丢失拖动位置');
        assert.equal(area.querySelectorAll('.eg-relations-panel').length, 0, '拖动预览窗不能打开关联面板');
        area.style.width = '1000px';
        leaf.view.renderer.onResize();
        await waitFor(() => mini.getBoundingClientRect().left >= moved.left - 2, '变宽后仍应保留拖动位置');
        assert.ok(mini.classList.contains('is-floating'), '变宽不能切换为停靠');
        const wide = mini.getBoundingClientRect(), wideMoved = dragPreview(mini, -24);
        assert.ok(wideMoved.left < wide.left - 15, '宽窗中也能拖动浮窗');
        area.style.width = '600px';
        leaf.view.renderer.onResize();
        await waitFor(() => mini.classList.contains('is-floating'), '回到同一个窄窗宽度应恢复浮窗');
        await waitFor(() => Math.abs(mini.getBoundingClientRect().width - moved.width) < 2, '回到旧宽度不能残留停靠尺寸');
        assert.ok(Math.abs(mini.getBoundingClientRect().left - wideMoved.left) < 2, '宽窄往返后应保留最后的手动位置');
        mini.querySelector('.eg-branch-preview-header').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 74, button: 0, bubbles: true }));
        assert.ok(mini.classList.contains('is-dragging'), '标题栏应能再次开始拖动');
        area.querySelector('.eg-hover-branches-toggle').click();
        assert.ok(mini.hidden, '关闭开关应隐藏浮窗');
        assert.equal(mini.classList.contains('is-dragging'), false, '关闭时应取消正在进行的拖动');
    } finally {
        if (original === null) area.removeAttribute('style'); else area.setAttribute('style', original);
        await cleanPolish(fixture);
    }
}
