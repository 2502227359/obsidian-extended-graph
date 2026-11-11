import assert from 'node:assert/strict';
import { appearanceFixture, showAppearance } from './graph-appearance.mjs';
import { cleanPolish } from './relations-polish.mjs';
import { waitFor } from './graph-fixture.mjs';
import { branchesHit, branchesDrag } from './branches-ui.mjs';
import { relationsDirectBranches } from './relations-direct.mjs';

export async function previewDockLayout(plugin) {
    const fixture = await appearanceFixture(plugin), { leaf } = fixture;
    const area = leaf.view.contentEl, original = area.getAttribute('style'), renderer = leaf.view.renderer;
    const container = renderer.containerEl, document = renderer.iframeEl.contentDocument;
    try {
        area.style.width = '1000px';
        renderer.onResize();
        const before = renderer.interactiveEl.getBoundingClientRect().width;
        const mini = await showAppearance(fixture);
        await waitFor(() => mini.classList.contains('is-docked'), '宽窗应提供独立停靠区');
        const canvas = renderer.interactiveEl.getBoundingClientRect(), preview = mini.getBoundingClientRect();
        assert.ok(canvas.width < before - 280 && canvas.width >= 500, '应实际缩窄主图画布并保留可用空间');
        assert.ok(canvas.right <= preview.left, '停靠预览不能覆盖主图画布');
        assert.ok(Math.abs(renderer.width - canvas.width) < 2, '宿主画布逻辑宽度应与实际点击区域一致');
        assert.ok(Math.abs(renderer.px.renderer.screen.width / window.devicePixelRatio - canvas.width) < 2, 'Pixi 分辨率应同步实际宽度');
        assert.equal(renderer.iframeEl.contentDocument, document, '停靠不能重载 iframe 内的 WebGL 环境');
        area.style.width = '950px';
        await waitFor(() => renderer.width === 606, '同为宽窗时也应同步新的画布尺寸');
        area.style.width = '1000px';
        await waitFor(() => renderer.width === 656, '恢复宽度后逻辑画布应同步');
        const width = canvas.width, left = preview.left;
        renderer.onNodeUnhover(); mini.dispatchEvent(new PointerEvent('pointerleave'));
        await waitFor(() => mini.hidden, '离开应收起临时内容');
        assert.ok(Math.abs(renderer.interactiveEl.getBoundingClientRect().width - width) < 1, '暂时离开不能反复改变主图尺寸');
        await showAppearance(fixture);
        assert.ok(Math.abs(mini.getBoundingClientRect().left - left) < 1, '重新悬浮应留在原停靠位置');
        area.style.width = '600px';
        await waitFor(() => !area.classList.contains('eg-preview-reserved') && renderer.width === 600, '变窄应自动恢复完整画布');
        area.style.width = '1000px';
        await waitFor(() => area.classList.contains('eg-preview-reserved') && renderer.width < 700, '变宽应重新预留停靠区');
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

export async function previewDockInteractions(plugin) {
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
        await waitFor(() => mini.classList.contains('is-floating'), '窄窗应保留紧凑浮窗');
        const initial = mini.getBoundingClientRect(), header = mini.querySelector('.eg-branch-preview-header');
        const start = { clientX: initial.left + 40, clientY: initial.top + 12, pointerId: 73, button: 0, bubbles: true, cancelable: true };
        header.dispatchEvent(new PointerEvent('pointerdown', start));
        area.ownerDocument.defaultView.dispatchEvent(new PointerEvent('pointermove', { ...start, clientX: start.clientX - 90, clientY: start.clientY + 28 }));
        area.ownerDocument.defaultView.dispatchEvent(new PointerEvent('pointerup', { ...start, clientX: start.clientX - 90, clientY: start.clientY + 28 }));
        const moved = mini.getBoundingClientRect();
        assert.ok(moved.left < initial.left - 50, '拖动标题栏应能移动浮窗');
        mini.querySelector(`g[data-path="${files[2].path}"]`).dispatchEvent(new MouseEvent('pointerenter', { clientX: 560, clientY: 390 }));
        await waitFor(() => mini.dataset.anchor === files[2].path, '浮窗仍可递归探索');
        assert.ok(Math.abs(mini.getBoundingClientRect().left - moved.left) < 2, '进入下一层不能丢失拖动位置');
        assert.equal(area.querySelectorAll('.eg-relations-panel').length, 0, '拖动预览窗不能打开关联面板');
        area.style.width = '1000px';
        await waitFor(() => mini.classList.contains('is-docked'), '拖动后变宽应进入停靠');
        area.style.width = '600px';
        await waitFor(() => mini.classList.contains('is-floating'), '回到同一个窄窗宽度应恢复浮窗');
        await waitFor(() => Math.abs(mini.getBoundingClientRect().width - moved.width) < 2, '回到旧宽度不能残留停靠尺寸');
        assert.ok(Math.abs(mini.getBoundingClientRect().left - moved.left) < 2, '宽窄往返后应恢复手动位置');
    } finally {
        if (original === null) area.removeAttribute('style'); else area.setAttribute('style', original);
        await cleanPolish(fixture);
    }
}
