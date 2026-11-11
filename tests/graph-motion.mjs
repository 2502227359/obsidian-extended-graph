import assert from 'node:assert/strict';
import { appearanceFixture, showAppearance } from './graph-appearance.mjs';
import { polishFixture, cleanPolish } from './relations-polish.mjs';
import { waitFor } from './graph-fixture.mjs';

export async function graphKeyboard(plugin) {
    const fixture = await appearanceFixture(plugin), { app, leaf, files } = fixture;
    try {
        let mini = await showAppearance(fixture);
        let node = mini.querySelector(`g[data-path="${files[2].path}"]`);
        node.focus();
        leaf.view.renderer.onNodeUnhover();
        mini.dispatchEvent(new PointerEvent('pointerleave'));
        await new Promise(resolve => setTimeout(resolve, 420));
        assert.equal(mini.hidden, false, '键盘焦点在小图内时不能自动淡出');
        assert.equal(node.getAttribute('role'), 'button');
        assert.equal(node.getAttribute('aria-label'), files[2].path);
        node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await waitFor(() => app.workspace.getLeavesOfType('markdown').some(l => l.view.file?.path === files[2].path), 'Enter 应打开焦点节点');
        app.workspace.setActiveLeaf(leaf, { focus: true });
        mini = await showAppearance(fixture);
        node = mini.querySelector(`g[data-path="${files[3].path}"]`);
        node.focus();
        const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
        node.dispatchEvent(space);
        assert.equal(space.defaultPrevented, true, 'Space 激活节点不能同时滚动页面');
        await waitFor(() => app.workspace.getLeavesOfType('markdown').some(l => l.view.file?.path === files[3].path), 'Space 应打开焦点节点');
    } finally { await cleanPolish(fixture); }
}

export async function graphPanelMotion(plugin) {
    const fixture = await polishFixture(plugin), { leaf, files, inputs } = fixture;
    try {
        inputs.showRelations(files[1].path);
        await waitFor(() => leaf.view.contentEl.querySelector('.eg-relations-target'), '关联面板应就绪');
        const panel = leaf.view.contentEl.querySelector('.eg-relations-panel');
        panel.querySelector('.eg-relations-target').focus();
        panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        assert.equal(leaf.view.contentEl.querySelector('.eg-relations-panel'), null, 'Esc 应立即关闭当前面板业务入口');
        const toggle = leaf.view.contentEl.querySelector('.eg-hover-branches-toggle');
        assert.equal(document.activeElement, toggle.offsetWidth ? toggle : leaf.view.renderer.interactiveEl, '关闭后焦点应回到当前图谱的可见操作区域');
        assert.equal(leaf.pinned, false, '关闭动画不能延迟释放中心固定');
        const exit = leaf.view.contentEl.querySelector('.eg-relations-exit');
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            assert.ok(exit?.inert, '退出动画只能留下不可操作的视觉层');
        } else {
            assert.equal(exit, null, '减少动态效果时应直接清理面板');
            assert.equal(getComputedStyle(toggle).transitionDuration, '0s', '系统减少动态效果也应关闭控件过渡');
        }
        await waitFor(() => !leaf.view.contentEl.querySelector('.eg-relations-exit'), '短过渡结束后必须清理视觉层');
        await assertReopen(leaf, files, inputs);
    } finally { await cleanPolish(fixture); }
}

export async function graphFadeContinuity(plugin) {
    const fixture = await appearanceFixture(plugin), { leaf } = fixture;
    try {
        const mini = await showAppearance(fixture);
        const layer = () => leaf.view.renderer.hanger.children.find(c => c.name === 'eg-branch-layer');
        leaf.view.renderer.onNodeUnhover();
        mini.dispatchEvent(new PointerEvent('pointerleave'));
        await waitFor(() => layer()?.alpha < 0.85 && layer()?.alpha > 0, '离开后应经过淡出中间状态');
        const before = layer().alpha;
        mini.dispatchEvent(new PointerEvent('pointerenter'));
        assert.ok(Math.abs(layer().alpha - before) < 0.05, '反向进入不能突然闪到全透明或全不透明');
        await waitFor(() => layer()?.alpha > 0.95, '重新进入后应平顺恢复可见');
        mini.dispatchEvent(new PointerEvent('pointerleave'));
        await waitFor(() => mini.hidden, '最终离开应完成淡出并清理');
        assert.equal(leaf.pinned, false, '动画结束应释放临时固定');
    } finally { await cleanPolish(fixture); }
}

async function assertReopen(leaf, files, inputs) {
    inputs.showRelations(files[1].path);
    await waitFor(() => leaf.view.contentEl.querySelector('.eg-relations-target'), '再次打开后应可操作');
    const panel = leaf.view.contentEl.querySelector('.eg-relations-panel');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) assert.equal(panel.getAnimations().length, 0, '减少动态效果时不能播放入场位移');
    panel.querySelector('.eg-relations-close').click();
    inputs.showRelations(files[1].path);
    await waitFor(() => leaf.view.contentEl.querySelector('.eg-relations-target'), '连续开关不能被退出层拦截');
    assert.equal(leaf.view.contentEl.querySelectorAll('.eg-relations-panel').length, 1);
    await new Promise(resolve => setTimeout(resolve, 220));
    assert.equal(leaf.view.contentEl.querySelector('.eg-relations-exit'), null, '重新打开后旧视觉层必须清理');
}
