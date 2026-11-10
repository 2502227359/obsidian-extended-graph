import assert from 'node:assert/strict';
import { ExtendedGraphInstances } from '../src/pluginInstances.ts';
import { waitFor } from './graph-fixture.mjs';

export const HEART = '临床医学/临床医学/内科学/3.2 心力衰竭.md';
export const THIRST = '临床医学/问题辨析/解析/利尿后口渴为什么不会抵消容量下降.md';
export const URINE = '临床医学/基础医学/生理生化基础/1.8.5 尿生成的调节.md';
export const CENTRAL = '临床医学/基础医学/生理生化基础/1.10.4 内脏活动调节-中枢调节与本能行为.md';

async function openGraph(plugin) {
    const leaf = plugin.app.workspace.getLeaf('tab');
    leaf.setPinned(true);
    await leaf.setViewState({ type: 'localgraph', state: { file: HEART }, active: true });
    leaf.setPinned(false);
    await waitFor(() => leaf.view.renderer?.nodes.length > 0, '心衰真实局部图谱应就绪');
    const manager = ExtendedGraphInstances.graphsManager;
    manager.graphLeavesManager.initLeaf(leaf);
    manager.lifecycleManager.enablePlugin(leaf.view, undefined, false);
    await waitFor(() => manager.allInstances.get(leaf.id)?.graphEventsDispatcher.inputsManager, '心衰图谱增强应就绪');
    return leaf;
}

function dispatchMiniHover(panel, path, x, y) {
    const node = panel.querySelector(`g[data-path="${CSS.escape(path)}"]`);
    assert.ok(node, `关系小图应显示 ${path}`);
    node.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true, clientX: x, clientY: y }));
}

function previewPaths(panel) {
    return new Set([...panel.querySelectorAll('g.eg-branch-preview-node[data-path]')]
        .map(node => node.getAttribute('data-path'))
        .filter(Boolean));
}

export async function branchesHeart(plugin) {
    const leaf = await openGraph(plugin);
    const view = leaf.view;
    const toggle = view.contentEl.querySelector('.eg-hover-branches-toggle');
    assert.ok(toggle, '心衰图谱工具区应有悬浮关联开关');
    const before = new Set(view.renderer.nodes.map(node => node.id));
    const initialEvent = new MouseEvent('mousemove', { clientX: 520, clientY: 360 });
    try {
        toggle.click();
        view.renderer.onNodeHover(initialEvent, THIRST, '');
        const panel = view.contentEl.querySelector('.eg-branch-preview');
        await waitFor(() => panel?.dataset.anchor === THIRST && !panel.hidden, '悬浮问题笔记应显示第一层关联');

        const firstPaths = previewPaths(panel);
        assert.ok(firstPaths.has(HEART), '第一层小图应保留心衰中心');
        assert.ok(firstPaths.has(URINE), '第一层小图应显示尿生成调节');
        assert.ok(firstPaths.has(CENTRAL), '第一层小图应显示中枢调节');
        assert.deepEqual(new Set(view.renderer.nodes.map(node => node.id)), before, '双处临时预览不得改变核心图节点');
        const layer = view.renderer.hanger.children.find(child => child.name === 'eg-branch-layer');
        assert.ok(layer?.visible, '主图临时层应同步显示');
        for (const path of [URINE, CENTRAL]) {
            assert.ok(layer.children.some(child => child.name === `eg-branch-node:${path}`), `主图临时层应显示 ${path}`);
        }

        dispatchMiniHover(panel, URINE, 590, 410);
        await waitFor(() => panel.dataset.anchor === URINE, '小图节点应能继续悬浮探索下一层');
        const secondPaths = previewPaths(panel);
        assert.ok(secondPaths.size >= 2, '第二层小图应显示当前节点及其关联');
        assert.deepEqual(new Set(view.renderer.nodes.map(node => node.id)), before, '逐层悬浮仍不得注入核心图');

        const retain = panel.querySelector('button[data-action="retain"]');
        assert.ok(retain, '第二层预览应提供保留这一层');
        retain.click();
        await waitFor(() => view.renderer.nodes.some(node => node.id === URINE), '保留这一层后尿生成调节应进入正式图');
        const instance = ExtendedGraphInstances.graphsManager.allInstances.get(leaf.id);
        await waitFor(() => instance?.nodesSet.extendedElementsMap.has(URINE), '正式图新增节点应由增强组件接管');

        const edge = panel.querySelector('line.eg-branch-preview-edge');
        assert.ok(edge, '第二层小图应保留真实有向边');
        const source = edge.getAttribute('data-source');
        const target = edge.getAttribute('data-target');
        assert.ok(source && target, '关系边应记录真实两端');
        edge.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
        await waitFor(() => view.contentEl.querySelector('.eg-relations-panel')?.dataset.center === source, '小图真实边应打开关联面板');
        const relations = view.contentEl.querySelector('.eg-relations-panel');
        assert.deepEqual(new Set([relations.dataset.center, relations.dataset.neighbor]), new Set([source, target]), '关联面板应绑定真实边的两端');
    } finally {
        leaf.detach();
        for (const popover of [...plugin.app.plugins['hover-editor-zh']?.activePopovers ?? []]) popover.hide();
    }
}
