import assert from 'node:assert/strict';
import { normalizePath } from 'obsidian';
import { RuleQuery } from '../src/queries/ruleQuery.ts';
import { ExtendedGraphInstances } from '../src/pluginInstances.ts';
import { GraphState } from '../src/states/state.ts';
import { GraphologyGraph } from '../src/statsCalculators/graphology.ts';
import { NodeStatCalculatorFactory } from '../src/statsCalculators/nodes/nodeStatCalculatorFactory.ts';
import { JaccardCalculator } from '../src/statsCalculators/links/jaccardCalculator.ts';
import { CoCitationsCalculator } from '../src/statsCalculators/links/coCitationsCalculator.ts';
import { SVGFixture } from './svg-fixture.mjs';
import { openCoreGraph, openGraph, waitFor } from './graph-fixture.mjs';
import { statesLayout } from './states-layout.mjs';
import { relationsQuery, relationsLocations } from './relations-query.mjs';
import { relationsPanel } from './relations-panel.mjs';
import { relationsHeart, relationsDirectHeart } from './relations-heart.mjs';
import { relationsRace } from './relations-race.mjs';
import { relationsPaths } from './relations-paths.mjs';
import { branchesHover, branchesExplore, branchesHit, branchesIsolation, branchesDrag } from './branches-ui.mjs';
import { centerPin } from './center-pin.mjs';
import { branchesData, branchesSources } from './branches-data.mjs';
import { branchesHeart } from './branches-heart.mjs';
import { relationsCommands, relationsCommandActions, relationsCommandTargets } from './relations-commands.mjs';
import { relationsDirect, relationsDirectSource, relationsDirectBranches, relationsDirectRace } from './relations-direct.mjs';
import { relationsPolishLabels, relationsPolishFeedback, relationsPolishRefresh } from './relations-polish.mjs';
import { branchControlsPolish } from './branch-controls-polish.mjs';

function graphWithNodes(...ids) {
    const graph = new GraphologyGraph();
    graph.graphology.clear();
    for (const id of ids) graph.graphology.addNode(id);
    return graph;
}

const cases = {
    '关系小图分页与保留按钮反馈真实状态': branchControlsPolish,
    '关联列表使用原文别名并保留标题与反向证据': relationsPolishLabels,
    '关联定位反馈与刷新失败不残留旧状态': relationsPolishFeedback,
    '关联更新保持阅读位置并区分同名笔记': relationsPolishRefresh,
    'Alt单击局部节点直达首处并切换关联浮窗': relationsDirect,
    'Alt单击整篇反链定位引用原文': relationsDirectSource,
    'Alt单击双处临时节点并保留拖动分流': relationsDirectBranches,
    '连续Alt单击取消旧关联自动预览': relationsDirectRace,
    '心衰Alt单击自动定位真实标题块和引用原文': relationsDirectHeart,
    '局部关联命令可绑定快捷键并隔离活动视图': relationsCommands,
    '局部关联命令覆盖节点引用分支与预览操作': relationsCommandActions,
    '局部关联命令节点选择与过期上下文隔离': relationsCommandTargets,
    '悬浮关联开关同步控制两处临时预览': branchesHover,
    '递归悬浮手动共享分支与原生预览分流': branchesExplore,
    '主图临时节点点击与实际引用端点': branchesHit,
    '悬浮关联区分正式节点拖动与临时节点单击': branchesDrag,
    '悬浮分支视图隔离换中心与关闭清理': branchesIsolation,
    '关联面板与悬浮预览共享中心固定状态': centerPin,
    '一层邻居与手动分支合并保留共享节点': branchesData,
    '分支来源过滤分页与索引增量更新': branchesSources,
    '心衰真实样本的双处预览与逐层探索': branchesHeart,
    '局部关联查询合并重复位置并保留双向来源': relationsQuery,
    '局部关联解析编码链接并提示失效与歧义': relationsLocations,
    '关联读取期间笔记变化不得使用旧来源位置': relationsRace,
    '关联查询遵循同名路径并保留属性与嵌入证据': relationsPaths,
    '局部节点菜单打开关联面板并发出准确悬浮链接': relationsPanel,
    '心衰真实样本的关联位置和悬浮编辑器定位': relationsHeart,
    '状态浮层默认与自定义状态的控件居中对齐': statesLayout,
    async '等待保存时关闭图谱不会阻止同一标签页再次启用'(plugin) {
        const graph = await openCoreGraph(plugin);
        const manager = ExtendedGraphInstances.graphsManager;
        const settings = ExtendedGraphInstances.settings;
        const previousSync = settings.syncDefaultState;
        settings.syncDefaultState = true;
        const adapter = plugin.app.vault.adapter;
        const originalWrite = adapter.write;
        adapter.write = async (destination, ...args) => {
            if (destination.endsWith('/data.json')) await new Promise(resolve => setTimeout(resolve, 50));
            return originalWrite.call(adapter, destination, ...args);
        };
        try {
            manager.lifecycleManager.enablePlugin(graph.view, undefined, false);
            await graph.leaf.setViewState({ type: 'empty' });
            await new Promise(resolve => setTimeout(resolve, 100));
            await graph.leaf.setViewState({ type: 'graph', active: true });
            const view = graph.leaf.view;
            await waitFor(() => view.renderer?.hanger && view.renderer.nodes.length > 0, '复用标签页的核心图谱应就绪');
            manager.graphLeavesManager.initLeaf(graph.leaf);
            manager.lifecycleManager.enablePlugin(view, undefined, false);
            await waitFor(() => manager.allInstances.get(graph.leaf.id)?.graphEventsDispatcher.inputsManager, '同一标签页应能重新启用');
        } finally {
            adapter.write = originalWrite;
            settings.syncDefaultState = previousSync;
            graph.leaf.detach();
            await plugin.saveSettings();
        }
    },
    async '缺失默认状态的旧配置可以正常加载'(plugin) {
        const saved = await plugin.loadData();
        try {
            await plugin.saveData({ states: [] });
            await plugin.loadSettings();
            assert.equal(ExtendedGraphInstances.settings.states[0].id, 'default-vault');
        } finally {
            await plugin.saveData(saved);
            await plugin.loadSettings();
        }
    },
    async '同步默认状态期间停用会取消待完成的启用'(plugin) {
        const graph = await openCoreGraph(plugin);
        const manager = ExtendedGraphInstances.graphsManager;
        const settings = ExtendedGraphInstances.settings;
        const previousSync = settings.syncDefaultState;
        const adapter = plugin.app.vault.adapter;
        const originalWrite = adapter.write;
        adapter.write = async (destination, ...args) => {
            if (destination.endsWith('/data.json')) await new Promise(resolve => setTimeout(resolve, 50));
            return originalWrite.call(adapter, destination, ...args);
        };
        settings.syncDefaultState = true;
        try {
            manager.lifecycleManager.enablePlugin(graph.view, undefined, false);
            manager.lifecycleManager.disablePlugin(graph.view);
            await new Promise(resolve => setTimeout(resolve, settings.delay + 200));
            assert.equal(manager.allInstances.has(graph.leaf.id), false, '保存结束后不得重新启用已取消的图谱');
            assert.equal(graph.view.renderer.setData, graph.original.setData);
        } finally {
            adapter.write = originalWrite;
            settings.syncDefaultState = previousSync;
            graph.leaf.detach();
            await plugin.saveSettings();
        }
    },
    async '按住修饰键可以开始并结束框选'(plugin) {
        const graph = await openGraph(plugin);
        try {
            const target = graph.view.renderer.interactiveEl;
            const bounds = target.getBoundingClientRect();
            target.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
                clientX: bounds.left + 10, clientY: bounds.top + 10,
                button: 0, buttons: 1, shiftKey: true,
            }));
            await waitFor(() => graph.instances.graphEventsDispatcher.inputsManager.isSelecting, '修饰键框选应开始');
            target.win.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
            assert.equal(graph.instances.graphEventsDispatcher.inputsManager.isSelecting, false);
        } finally {
            graph.leaf.detach();
        }
    },
    async '初始化期间停用不会留下或复活增强组件'(plugin) {
        const graph = await openCoreGraph(plugin);
        const manager = ExtendedGraphInstances.graphsManager;
        try {
            manager.lifecycleManager.enablePlugin(graph.view, undefined, false);
            manager.lifecycleManager.disablePlugin(graph.view);
            await new Promise(resolve => setTimeout(resolve, ExtendedGraphInstances.settings.delay + 100));
            assert.equal(manager.allInstances.has(graph.leaf.id), false);
            assert.equal(graph.view.renderer.setData, graph.original.setData);
            assert.equal(graph.view.onOptionsChange, graph.original.onOptionsChange);
            assert.equal(graph.view.renderer.px.stage.listeners('pointerdown').length, graph.original.pointerListeners);
        } finally {
            graph.leaf.detach();
        }
    },
    async '停用插件恢复已打开图谱并可重新启用'(plugin) {
        const graph = await openGraph(plugin);
        const manager = ExtendedGraphInstances.graphsManager;
        try {
            await plugin.app.plugins.disablePlugin('extended-graph');
            assert.equal(graph.view.renderer.setData, graph.original.setData, '停用后应恢复核心图谱方法');
            assert.equal(graph.view.onOptionsChange, graph.original.onOptionsChange);
            assert.equal(manager.allInstances.size, 0);
            assert.equal(document.querySelectorAll('.status-bar-item.plugin-extended-graph').length, 0, '停用后不得残留状态栏');
            assert.equal(graph.view.contentEl.querySelectorAll('.mod-extended-graph-toggle').length, 0, '停用后应移除增强控件');
            await plugin.app.plugins.enablePlugin('extended-graph');
            assert.equal(graph.view.contentEl.querySelectorAll('.mod-extended-graph-toggle').length, 1, '重启后只应有一组控件');
        } finally {
            graph.leaf.detach();
            if (!plugin.app.plugins.plugins['extended-graph']) await plugin.app.plugins.enablePlugin('extended-graph');
        }
    },
    async '前一个图谱缺少笔记时其他图谱仍更新'(plugin) {
        const settings = ExtendedGraphInstances.settings;
        const previousTags = settings.enableFeatures.graph.tags;
        settings.enableFeatures.graph.tags = true;
        const file = plugin.app.vault.getAbstractFileByPath('outside/X.md');
        const original = await plugin.app.vault.read(file);
        const graphs = [];
        try {
            graphs.push(await openGraph(plugin, 'path:notes/'));
            assert.equal(graphs[0].instances.nodesSet.extendedElementsMap.has(file.path), false, '第一个图谱必须排除被修改笔记');
            graphs.push(await openGraph(plugin));
            const node = graphs[1].instances.nodesSet.extendedElementsMap.get(file.path);
            assert.ok(node.getTypes('tag').has('outside'));
            await plugin.app.fileManager.processFrontMatter(file, frontmatter => {
                frontmatter.tags = ['regression-updated'];
            });
            await waitFor(() => node.getTypes('tag').has('regression-updated'), '后面的图谱必须接收笔记元数据更新');
            assert.equal(node.getTypes('tag').has('outside'), false);
        } finally {
            for (const graph of graphs) graph.leaf.detach();
            settings.enableFeatures.graph.tags = previousTags;
            await plugin.app.vault.modify(file, original);
        }
    },
    async 'SVG导出保留原点附近的图形'() {
        const svg = new SVGFixture({}).render();
        assert.equal(svg.getAttribute('viewBox'), '0 0 110 110');
        assert.equal(svg.isConnected, false, '导出后不应残留临时 SVG');
    },
    async '共引统计等待笔记读取完成'() {
        const graph = graphWithNodes('notes/A.md', 'notes/B.md', 'notes/Pre.md');
        graph.graphology.addEdge('notes/Pre.md', 'notes/A.md');
        graph.graphology.addEdge('notes/Pre.md', 'notes/B.md');
        graph.graphology.addEdge('notes/A.md', 'notes/B.md');
        const calculator = new CoCitationsCalculator('size', graph);
        await calculator.computeStats('normal');
        await waitFor(() => calculator.linksStats?.['notes/A.md']?.['notes/B.md'], '共引统计应完成');
        assert.equal(calculator.linksStats['notes/A.md']['notes/B.md'].measure, 1);
    },
    async '图关系改变后链接统计重新计算'() {
        const graph = graphWithNodes('A', 'B', 'C');
        graph.graphology.addEdge('A', 'B');
        const calculator = new JaccardCalculator('size', graph);
        await calculator.computeStats('normal');
        await waitFor(() => calculator.linksStats?.A?.B, '首次链接统计应完成');
        assert.equal(calculator.linksStats.A.B.measure, 0);
        const previous = calculator.linksStats;
        graph.graphology.addEdge('A', 'C');
        graph.graphology.addEdge('B', 'C');
        await calculator.computeStats('normal');
        await waitFor(() => calculator.linksStats !== previous && calculator.linksStats?.B?.C, '更新后的链接统计应完成');
        assert.equal(calculator.linksStats.A.B.measure, 1 / 3);
        assert.ok(Number.isFinite(calculator.linksStats.A.C.measure));
    },
    async '正反向链接计数与唯一计数符合方向'() {
        const graph = graphWithNodes('A', 'B');
        graph.graphology.addEdge('A', 'B', { count: 2 });
        for (const direction of ['normal', 'reversed']) {
            for (const fn of ['backlinksCount', 'backUniquelinksCount', 'forwardlinksCount', 'forwardUniquelinksCount']) {
                const settings = { nodesSizeFunction: fn, graphStatsDirection: direction };
                const calculator = NodeStatCalculatorFactory.getCalculator('size', { settings, graphologyGraph: graph });
                await calculator.computeStats(direction);
                await waitFor(() => calculator.filesStats?.size === 2, '节点统计应完成');
                const backwards = fn.startsWith('back') !== (direction === 'reversed');
                const count = fn.includes('Unique') ? 1 : 2;
                assert.equal(calculator.filesStats.get('A').measure, backwards ? 0 : count, `${direction}/${fn}/A`);
                assert.equal(calculator.filesStats.get('B').measure, backwards ? count : 0, `${direction}/${fn}/B`);
            }
        }
    },
    async '状态配置首次保存与覆盖均可读取'(plugin) {
        const manager = ExtendedGraphInstances.statesManager;
        const state = new GraphState('回归测试状态配置');
        state.setID('regression-config');
        const filepath = normalizePath(ExtendedGraphInstances.configurationDirectory + '/回归测试状态配置.json');
        const adapter = plugin.app.vault.adapter;
        const originalWrite = adapter.write;
        const pending = [];
        adapter.write = (destination, ...args) => {
            const writing = (async () => {
                if (destination === filepath) await new Promise(resolve => setTimeout(resolve, 50));
                return originalWrite.call(adapter, destination, ...args);
            })();
            pending.push(writing);
            return writing;
        };
        if (await plugin.app.vault.adapter.exists(filepath)) await plugin.app.vault.adapter.remove(filepath);
        const settings = structuredClone(ExtendedGraphInstances.settings);
        settings.saveConfigsWithState = true;
        settings.zoomFactor = 1.25;
        try {
            await manager.saveConfigForState({ settings }, state);
            assert.equal(manager.getConfig(state.data.id).zoomFactor, 1.25);
            settings.zoomFactor = 2.5;
            await manager.saveConfigForState({ settings }, state);
            assert.equal(manager.getConfig(state.data.id).zoomFactor, 2.5);
            const reloaded = await plugin.loadConfigFile(filepath);
            assert.equal(reloaded.zoomFactor, 2.5);
        } finally {
            adapter.write = originalWrite;
            await Promise.all(pending);
            if (await plugin.app.vault.adapter.exists(filepath)) await plugin.app.vault.adapter.remove(filepath);
        }
    },
    async '旧配置升级保留用户设置'(plugin) {
        const saved = await plugin.loadData();
        try {
            await plugin.saveData({
                imageProperty: 'cover', iconProperty: 'symbol',
                nodesSizeProperty: 'weight', usePropertyForName: 'title',
                invertNodeStats: true, obsoleteSetting: true,
            });
            await plugin.loadSettings();
            const settings = ExtendedGraphInstances.settings;
            assert.deepEqual(settings.imageProperties, ['cover']);
            assert.deepEqual(settings.iconProperties, ['symbol']);
            assert.deepEqual(settings.nodesSizeProperties, ['weight']);
            assert.deepEqual(settings.usePropertiesForName, ['title']);
            assert.equal(settings.graphStatsDirection, 'reversed');
            assert.equal('imageProperty' in settings, false);
            assert.equal('obsoleteSetting' in settings, false);
        } finally {
            await plugin.saveData(saved);
            await plugin.loadSettings();
        }
    },
    async '文件夹查询使用父文件夹'(plugin) {
        const file = plugin.app.vault.getAbstractFileByPath('notes/A.md');
        assert.ok(file, '测试笔记应存在');
        const query = new RuleQuery({ source: 'folder', logic: 'is', value: 'notes' });
        assert.equal(query.doesMatch(file), true);
        query.value = 'notes/A.md';
        assert.equal(query.doesMatch(file), false);
    },
};

// 真实库样本及 Hover Editor 验收由显式传入样本路径的独立脚本运行。
export const caseNames = Object.keys(cases).filter(name => ![
    '心衰真实样本的关联位置和悬浮编辑器定位', '心衰真实样本的双处预览与逐层探索', '心衰Alt单击自动定位真实标题块和引用原文',
].includes(name));

export async function runRegression(name, plugin) {
    assert.equal(plugin.app.vault.getName(), '.test-vault', '只允许操作独立测试库');
    assert.ok(Object.hasOwn(cases, name), `未知测试：${name}`);
    await cases[name](plugin);
}
