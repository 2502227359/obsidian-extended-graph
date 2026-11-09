import assert from 'node:assert/strict';
import { ExtendedGraphInstances } from '../src/pluginInstances.ts';

export async function waitFor(condition, message) {
    const deadline = Date.now() + 5000;
    while (!condition()) {
        assert.ok(Date.now() < deadline, message);
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

export async function openCoreGraph(plugin, search = '') {
    const leaf = plugin.app.workspace.getLeaf('tab');
    try {
        await leaf.setViewState({ type: 'graph', active: true });
        const view = leaf.view;
        await waitFor(() => view.renderer?.hanger && view.renderer.nodes.length > 0, '核心图谱应完成初始化');
        view.dataEngine.setOptions({ ...view.dataEngine.getOptions(), search });
        await waitFor(() => search === '' || !view.renderer.nodes.some(node => node.id === 'outside/X.md'), '核心筛选应生效');
        const original = {
            setData: view.renderer.setData, onOptionsChange: view.onOptionsChange,
            pointerListeners: view.renderer.px.stage.listeners('pointerdown').length,
        };
        return { leaf, view, original };
    } catch (error) {
        leaf.detach();
        throw error;
    }
}

export async function openGraph(plugin, search = '') {
    const core = await openCoreGraph(plugin, search);
    const { leaf, view } = core;
    try {
        const manager = ExtendedGraphInstances.graphsManager;
        manager.graphLeavesManager.initLeaf(leaf);
        manager.lifecycleManager.enablePlugin(view, undefined, false);
        await waitFor(() => manager.allInstances.get(leaf.id)?.graphEventsDispatcher.inputsManager, '增强图谱应完成初始化');
        return { ...core, instances: manager.allInstances.get(leaf.id) };
    } catch (error) {
        leaf.detach();
        throw error;
    }
}
