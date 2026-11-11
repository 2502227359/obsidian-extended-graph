import assert from 'node:assert/strict';
import { ExtendedGraphInstances } from '../src/pluginInstances.ts';
import { GraphState } from '../src/states/state.ts';
import { polishFixture, cleanPolish } from './relations-polish.mjs';
import { waitFor } from './graph-fixture.mjs';

async function depthFixture(plugin) {
    const fixture = await polishFixture(plugin), { app, leaf, files } = fixture;
    for (const name of ['Second', 'Third', 'Fourth']) files.push(await app.vault.create('relations-polish/' + name + '.md', '# ' + name));
    for (let i = 1; i < files.length - 1; ++i) await app.vault.modify(files[i], `# 第${i}层\n[[${files[i + 1].path}]]\n`);
    await waitFor(() => files.slice(1, -1).every((file, i) => app.metadataCache.resolvedLinks[file.path]?.[files[i + 2].path]), '四层链应完成索引');
    const instances = ExtendedGraphInstances.graphsManager.allInstances.get(leaf.id);
    instances.engine.setOptions({ localJumps: 1, localBacklinks: true, localForelinks: true, search: '' });
    await waitFor(() => button(leaf, 1) && !button(leaf, 1).disabled, '初始化状态应完成后再允许切换层数');
    return { ...fixture, instances };
}

function button(leaf, depth) {
    return leaf.view.contentEl.querySelector(`.eg-local-depth button[data-depth="${depth}"]`);
}

async function expectDepth(fixture, depth) {
    const { leaf, files, instances } = fixture;
    await waitFor(() => instances.engine.options.localJumps === depth && files.every((file, index) =>
        leaf.view.renderer.nodes.some(node => node.id === file.path) === (index <= depth)), `应只显示中心到第 ${depth} 层的节点`);
    assert.equal(button(leaf, depth)?.getAttribute('aria-pressed'), 'true', '选中层数应与实际深度一致');
    assert.equal(leaf.view.contentEl.querySelectorAll('.eg-local-depth [aria-pressed="true"]').length, 1);
}

export async function localDepthChanges(plugin) {
    const fixture = await depthFixture(plugin), { leaf, instances } = fixture;
    try {
        assert.ok(button(leaf, 1), '局部图谱应提供可直接点击的层数选择器');
        await expectDepth(fixture, 1);
        for (const depth of [2, 3, 1]) { button(leaf, depth).click(); await expectDepth(fixture, depth); }
        instances.engine.setOptions({ localJumps: 2 });
        await expectDepth(fixture, 2);
        const filter = leaf.view.contentEl.querySelector('.graph-control-section.mod-filter');
        if (filter.classList.contains('is-collapsed')) filter.querySelector('.tree-item-self').click();
        const slider = filter.querySelector('.mod-local-jumps input[type="range"]');
        assert.ok(slider, '应复用实际原生深度滑块');
        assert.equal(slider.value, '2', '新控件应同步原生滑块');
        slider.value = '3';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        await expectDepth(fixture, 3);
        instances.engine.setOptions({ localJumps: 4 });
        await waitFor(() => leaf.view.contentEl.querySelectorAll('.eg-local-depth [aria-pressed="true"]').length === 0, '原生其他深度不能误标');
        button(leaf, 1).click();
        await expectDepth(fixture, 1);
    } finally { await cleanPolish(fixture); }
}

export async function localDepthLayout(plugin) {
    const fixture = await depthFixture(plugin), { leaf } = fixture;
    const area = leaf.view.contentEl, controls = area.querySelector('.graph-controls');
    const original = area.getAttribute('style'), closed = controls.classList.contains('is-close');
    try {
        assert.ok(button(leaf, 1), '层数选择器应存在');
        for (const width of [360, 420, 800]) {
            area.style.width = width + 'px';
            for (const close of [true, false]) {
                controls.classList.toggle('is-close', close);
                await new Promise(resolve => setTimeout(resolve, 80));
                const bounds = area.getBoundingClientRect(), group = area.querySelector('.eg-local-depth').getBoundingClientRect();
                assert.ok(group.width > 0 && group.left >= bounds.left && group.right <= bounds.right + 1, `${width} 像素下设置${close ? '折叠' : '展开'}仍可切换层数`);
                for (const depth of [1, 2, 3]) assert.ok(button(leaf, depth).getBoundingClientRect().width >= 28, '点击区域不能挤没');
                const tool = area.querySelector('.eg-local-tools').getBoundingClientRect(), core = controls.getBoundingClientRect();
                assert.ok(Math.min(tool.right, core.right) <= Math.max(tool.left, core.left) + 1 || tool.bottom <= core.top + 1, '新工具栏不能遮住原生设置');
            }
        }
        button(leaf, 1).focus();
        button(leaf, 1).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        await expectDepth(fixture, 2);
        assert.equal(area.ownerDocument.activeElement, button(leaf, 2), '方向键应移动焦点并切换层数');
    } finally {
        controls.classList.toggle('is-close', closed);
        if (original === null) area.removeAttribute('style'); else area.setAttribute('style', original);
        await cleanPolish(fixture);
    }
}

export async function localDepthSessions(plugin) {
    const fixture = await depthFixture(plugin), { app, leaf, files, instances } = fixture;
    let other;
    try {
        other = app.workspace.getLeaf('tab');
        other.setPinned(true);
        await other.setViewState({ type: 'localgraph', state: { file: files[0].path }, active: true });
        const manager = ExtendedGraphInstances.graphsManager;
        manager.graphLeavesManager.initLeaf(other);
        manager.lifecycleManager.enablePlugin(other.view, undefined, false);
        await waitFor(() => manager.allInstances.get(other.id)?.graphEventsDispatcher.inputsManager, '第二个局部视图应完成增强初始化');
        other.view.engine.setOptions({ localJumps: 1 });
        app.workspace.setActiveLeaf(leaf, { focus: true });
        const toggle = leaf.view.contentEl.querySelector('.eg-hover-branches-toggle');
        toggle.click();
        leaf.view.renderer.onNodeHover(new MouseEvent('mousemove', { clientX: 500, clientY: 350 }), files[1].path, '');
        await waitFor(() => leaf.view.contentEl.querySelector('.eg-branch-preview:not([hidden])'), '切换前应显示悬浮层');
        button(leaf, 3).click();
        await expectDepth(fixture, 3);
        assert.equal(other.view.engine.options.localJumps, 1, '层数不能影响另一个局部图谱');
        assert.equal(toggle.getAttribute('aria-pressed'), 'true', '切换不能关闭悬浮开关');
        assert.ok(leaf.view.contentEl.querySelector('.eg-branch-preview').hidden, '切换应清理旧悬浮层');
        assert.equal(leaf.pinned, false, '清理悬浮层应释放临时中心固定');
        instances.graphEventsDispatcher.branches.toggleBranch(files[1].path);
        button(leaf, 1).click();
        assert.ok(instances.graphEventsDispatcher.branches.expansions.anchors.has(files[1].path), '切回一层应保留手动分支所有权');
        await waitFor(() => leaf.view.renderer.nodes.some(node => node.id === files[2].path), '手动保留的第二层仍应显示');
        await waitFor(() => instances.graphEventsDispatcher.initTimeout === undefined, '重建图形应完成后再关闭视图');
    } finally { other?.detach(); await cleanPolish(fixture); }
    assert.equal(leaf.view.contentEl.querySelector('.eg-local-tools'), null, '关闭视图必须清理整条工具栏');
}

export async function localDepthLimit(plugin) {
    const fixture = await depthFixture(plugin);
    const settings = ExtendedGraphInstances.settings, old = { maxNodes: settings.maxNodes, revertAction: settings.revertAction };
    try {
        await expectDepth(fixture, 1);
        settings.maxNodes = 2;
        settings.revertAction = true;
        button(fixture.leaf, 3).click();
        await expectDepth(fixture, 1);
        assert.ok(fixture.instances.graphEventsDispatcher._loaded, '超限撤销时增强功能应保持启用');
    } finally { Object.assign(settings, old); await cleanPolish(fixture); }
}

export async function localDepthState(plugin) {
    const fixture = await depthFixture(plugin), { instances, leaf } = fixture;
    const states = ExtendedGraphInstances.settings.states;
    const state = new GraphState('层数状态验收');
    state.data.id = 'regression-local-depth-state';
    state.data.engineOptions = { ...instances.engine.getOptions(), localJumps: 2 };
    states.push(state.data);
    try {
        instances.statesUI.selectState.addOption(state.data.id, state.data.name);
        instances.statesUI.setValue(state.data.id);
        instances.graphEventsDispatcher.changeState(state.data.id);
        await expectDepth(fixture, 2);
        await waitFor(() => !button(leaf, 2).disabled, '状态应用完成后应恢复快捷切换');
        button(leaf, 1).click();
        await expectDepth(fixture, 1);
    } finally { states.splice(states.indexOf(state.data), 1); await cleanPolish(fixture); }
}
