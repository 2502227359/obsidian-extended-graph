import { GraphView, LocalGraphView } from "obsidian-typings";
import { Pinner, ExtendedGraphInstances, t } from "./internal";
import ExtendedGraphPlugin from "./main";
import { ItemView, TFile } from "obsidian";
import { GraphInstances } from "./pluginInstances";
import { GraphNodeModal } from "./ui/modals/graphNodeModal";

export function getActiveGraphView(plugin: ExtendedGraphPlugin): GraphView | LocalGraphView | undefined {
    const itemView = plugin.app.workspace.getActiveViewOfType(ItemView);
    if (itemView
        && (itemView.getViewType() === "graph" || itemView.getViewType() === "localgraph")) {
        return itemView as GraphView | LocalGraphView;
    }
}

export function addCommands(plugin: ExtendedGraphPlugin) {
    addEnableCommands(plugin);
    addSVGCommands(plugin);
    addStateCommands(plugin);
    addFolderCommands(plugin);
    addPinCommands(plugin);
    addSelectCommands(plugin);
    addFocusCommands(plugin);
    addRelationCommands(plugin);
}

function getActiveLocalGraph(plugin: ExtendedGraphPlugin): GraphInstances | undefined {
    const view = getActiveGraphView(plugin);
    if (view?.getViewType() !== "localgraph") return;
    const instances = ExtendedGraphInstances.graphsManager.allInstances.get(view.leaf.id);
    if (instances?.graphEventsDispatcher.inputsManager && instances.graphEventsDispatcher.branches) return instances;
}

interface RelationCommand {
    id: string;
    name: string;
    run: (instances: GraphInstances) => void;
    available?: (instances: GraphInstances) => boolean;
}

type NodeRelationAction = "show" | "expand" | "collapse";

function addRelationCommands(plugin: ExtendedGraphPlugin): void {
    const commands: RelationCommand[] = [
        { id: "toggle-hover-relations", name: "切换悬浮关联预览", run: i => i.graphEventsDispatcher.branches!.toggle() },
        { id: "toggle-relation-sources", name: "切换来源关联显示", run: i => i.graphEventsDispatcher.branches!.toggleSources() },
        { id: "clear-manual-branches", name: "收起全部手动分支", run: i => i.graphEventsDispatcher.branches!.clearManual(),
            available: i => i.graphEventsDispatcher.branches!.expansions.anchors.size > 0 },
        { id: "keep-preview-branch", name: "保留当前预览这一层", run: i => i.graphEventsDispatcher.branches!.keepPreview(),
            available: i => { const b = i.graphEventsDispatcher.branches!; return !!b.previewAnchor && !b.expansions.anchors.has(b.previewAnchor); } },
        { id: "close-node-relations", name: "关闭关联位置面板", available: i => !!i.graphEventsDispatcher.relationsUI?._loaded,
            run: i => { const d = i.graphEventsDispatcher; d.relationsUI!.closePanel(); d.relationsUI = undefined; } },
    ];
    const nodeCommands: [string, string, NodeRelationAction][] = [
        ["show-node-relations", "查看节点与中心关联", "show"],
        ["expand-node-branch", "展开节点一层关联", "expand"],
        ["collapse-node-branch", "收起节点这一层关联", "collapse"],
    ];
    for (const [id, name, action] of nodeCommands) commands.push({
        id, name,
        available: i => canRunNodeRelation(i, action),
        run: i => chooseRelationNode(plugin, i, action),
    });
    for (const command of commands) registerRelationCommand(plugin, command);
}

function registerRelationCommand(plugin: ExtendedGraphPlugin, command: RelationCommand): void {
    plugin.addCommand({
        id: command.id,
        name: `局部关联：${command.name}`,
        checkCallback: checking => {
            const instances = getActiveLocalGraph(plugin);
            if (!instances || (command.available && !command.available(instances))) return false;
            if (!checking) command.run(instances);
            return true;
        },
    });
}

function relationFiles(instances: GraphInstances, action: NodeRelationAction): TFile[] {
    const branches = instances.graphEventsDispatcher.branches!;
    const paths = action === "collapse" ? [...branches.expansions.anchors]
        : [...new Set([...instances.renderer.nodes.map(node => node.id), ...branches.getPreviewNodes()])];
    return paths.filter(path => action !== "expand" || !branches.expansions.anchors.has(path))
        .map(path => ExtendedGraphInstances.app.vault.getAbstractFileByPath(path))
        .filter((file): file is TFile => file instanceof TFile && file.extension === "md")
        .sort((a, b) => a.path.localeCompare(b.path));
}

function explicitRelationNode(instances: GraphInstances): string | undefined {
    const hover = instances.graphEventsDispatcher.branches!.getHoveredNode();
    if (hover) return hover;
    const selected = Object.keys(instances.nodesSet.selectedNodes);
    if (selected.length === 1) return selected[0];
}

function canRunNodeRelation(instances: GraphInstances, action: NodeRelationAction): boolean {
    const target = explicitRelationNode(instances), files = relationFiles(instances, action);
    return target ? files.some(file => file.path === target) : files.length > 0;
}

function chooseRelationNode(plugin: ExtendedGraphPlugin, instances: GraphInstances, action: NodeRelationAction): void {
    const root = (instances.view as LocalGraphView).file?.path;
    const files = relationFiles(instances, action), target = explicitRelationNode(instances);
    const apply = (file: TFile) => {
        if (getActiveLocalGraph(plugin) !== instances || (instances.view as LocalGraphView).file?.path !== root) return;
        if (!relationFiles(instances, action).includes(file)) return;
        if (action === "show") instances.graphEventsDispatcher.inputsManager.showRelations(file.path);
        else instances.graphEventsDispatcher.branches!.toggleBranch(file.path);
    };
    if (target) {
        const file = files.find(file => file.path === target);
        if (file) apply(file);
    } else new GraphNodeModal(plugin.app, files, apply).open();
}

function addEnableCommands(plugin: ExtendedGraphPlugin) {
    plugin.addCommand({
        id: 'enable-in-graph-view',
        name: t("controls.enableInGraphView"),
        checkCallback: (checking: boolean) => {
            const graphView = getActiveGraphView(plugin);
            if (graphView && !ExtendedGraphInstances.graphsManager.lifecycleManager.isPluginAlreadyEnabled(graphView)) {
                if (!checking) {
                    ExtendedGraphInstances.graphsManager.lifecycleManager.enablePlugin(graphView);
                }
                return true;
            }
        }
    });

    plugin.addCommand({
        id: 'disable-in-graph-view',
        name: t("controls.disableInGraphView"),
        checkCallback: (checking: boolean) => {
            const graphView = getActiveGraphView(plugin);
            if (graphView && ExtendedGraphInstances.graphsManager.lifecycleManager.isPluginAlreadyEnabled(graphView)) {
                if (!checking) {
                    ExtendedGraphInstances.graphsManager.lifecycleManager.disablePlugin(graphView);
                }
                return true;
            }
        }
    });

    plugin.addCommand({
        id: 'reset-in-graph-view',
        name: t("controls.resetInGraphView"),
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const graphView = getActiveGraphView(plugin);
            if (graphView && ExtendedGraphInstances.graphsManager.lifecycleManager.isPluginAlreadyEnabled(graphView)) {
                if (!checking) {
                    ExtendedGraphInstances.graphsManager.lifecycleManager.resetPlugin(graphView);
                }
                return true;
            }
        }
    });
}

function addSVGCommands(plugin: ExtendedGraphPlugin) {
    plugin.addCommand({
        id: 'copy-svg-screenshot',
        name: t("features.svgScreenshotCopy"),
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const graphView = getActiveGraphView(plugin);
            if (graphView) {
                if (!checking) {
                    ExtendedGraphInstances.graphsManager.getSVGScreenshot(graphView);
                }
                return true;
            }
        }
    });
}

function addStateCommands(plugin: ExtendedGraphPlugin) {
    plugin.addCommand({
        id: 'save-for-default-state',
        name: t("states.saveForDefaultState"),
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const graphView = getActiveGraphView(plugin);
            if (graphView) {
                if (!checking) {
                    ExtendedGraphInstances.statesManager.saveForDefaultState(graphView);
                }
                return true;
            }
        }
    });

    plugin.addCommand({
        id: 'save-for-normal-state',
        name: t("states.saveForNormalState") + " " + t("states.saveForNormalStateDesc"),
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const graphView = getActiveGraphView(plugin);
            if (graphView && ExtendedGraphInstances.graphsManager.lifecycleManager.isPluginAlreadyEnabled(graphView)) {
                if (!checking) {
                    ExtendedGraphInstances.statesManager.saveForNormalState(graphView);
                }
                return true;
            }
        }
    });

    plugin.addCommand({
        id: 'show-graph-state',
        name: t("states.showGraphState"),
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const graphView = getActiveGraphView(plugin);
            if (graphView && ExtendedGraphInstances.graphsManager.lifecycleManager.isPluginAlreadyEnabled(graphView)) {
                if (!checking) {
                    ExtendedGraphInstances.statesManager.showGraphState(graphView);
                }
                return true;
            }
        }
    });
}

function addFolderCommands(plugin: ExtendedGraphPlugin) {
    plugin.addCommand({
        id: 'enable-all-folders',
        name: `${t("plugin.folders")}: ${t("controls.showAll")}`,
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const graphView = getActiveGraphView(plugin);
            if (graphView && ExtendedGraphInstances.graphsManager.lifecycleManager.isPluginAlreadyEnabled(graphView)) {
                if (!checking) {
                    const instances = ExtendedGraphInstances.graphsManager.allInstances.get(graphView.leaf.id);
                    instances?.foldersSet?.enableAll();
                }
                return true;
            }
        }
    });

    plugin.addCommand({
        id: 'enable-more-than-one-node-folders',
        name: `${t("plugin.folders")}: ${t("controls.showAll")} (${t("controls.toggleAllWithMoreThanOneNode")})`,
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const graphView = getActiveGraphView(plugin);
            if (graphView && ExtendedGraphInstances.graphsManager.lifecycleManager.isPluginAlreadyEnabled(graphView)) {
                if (!checking) {
                    const instances = ExtendedGraphInstances.graphsManager.allInstances.get(graphView.leaf.id);
                    instances?.foldersSet?.enableAllWithAtLeastOneNode();
                }
                return true;
            }
        }
    });

    plugin.addCommand({
        id: 'disable-all-folders',
        name: `${t("plugin.folders")}: ${t("controls.hideAll")}`,
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const graphView = getActiveGraphView(plugin);
            if (graphView && ExtendedGraphInstances.graphsManager.lifecycleManager.isPluginAlreadyEnabled(graphView)) {
                if (!checking) {
                    const instances = ExtendedGraphInstances.graphsManager.allInstances.get(graphView.leaf.id);
                    instances?.foldersSet?.disableAll();
                }
                return true;
            }
        }
    });

    plugin.addCommand({
        id: 'disable-more-than-one-node-folders',
        name: `${t("plugin.folders")}: ${t("controls.hideAll")} (${t("controls.toggleAllWithMoreThanOneNode")})`,
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const graphView = getActiveGraphView(plugin);
            if (graphView && ExtendedGraphInstances.graphsManager.lifecycleManager.isPluginAlreadyEnabled(graphView)) {
                if (!checking) {
                    const instances = ExtendedGraphInstances.graphsManager.allInstances.get(graphView.leaf.id);
                    instances?.foldersSet?.disableAllWithAtLeastOneNode();
                }
                return true;
            }
        }
    });
}

function addPinCommands(plugin: ExtendedGraphPlugin) {

    plugin.addCommand({
        id: 'pin-selected-nodes',
        name: t("features.pinSelectedNodes"),
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const graphView = getActiveGraphView(plugin);
            if (graphView && ExtendedGraphInstances.graphsManager.lifecycleManager.isPluginAlreadyEnabled(graphView)) {
                const instances = ExtendedGraphInstances.graphsManager.allInstances.get(graphView.leaf.id);
                if (!instances || Object.keys(instances.nodesSet.selectedNodes).length === 0) {
                    return;
                }
                if (!checking) {
                    instances.nodesSet.pinSelectedNodes();
                }
                return true;
            }
        }
    });

    plugin.addCommand({
        id: 'unpin-selected-nodes',
        name: t("features.unpinSelectedNodes"),
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const graphView = getActiveGraphView(plugin);
            if (graphView && ExtendedGraphInstances.graphsManager.lifecycleManager.isPluginAlreadyEnabled(graphView)) {
                const instances = ExtendedGraphInstances.graphsManager.allInstances.get(graphView.leaf.id);
                if (!instances || Object.keys(instances.nodesSet.selectedNodes).length === 0) {
                    return;
                }
                if (Object.keys(instances.nodesSet.selectedNodes).every(id => !instances.nodesSet.isNodePinned(id))) {
                    return;
                }
                if (!checking) {
                    instances.nodesSet.unpinSelectedNodes();
                }
                return true;
            }
        }
    });

    plugin.addCommand({
        id: 'unpin-all-nodes',
        name: t("features.unpinAllNodes"),
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const graphView = getActiveGraphView(plugin);
            if (graphView && ExtendedGraphInstances.graphsManager.lifecycleManager.isPluginAlreadyEnabled(graphView)) {
                if (!checking) {
                    const instances = ExtendedGraphInstances.graphsManager.allInstances.get(graphView.leaf.id);
                    if (instances) {
                        new Pinner(instances).unpinAllNodes();
                    }
                }
                return true;
            }
        }
    });
}

function addSelectCommands(plugin: ExtendedGraphPlugin) {
    plugin.addCommand({
        id: 'select-all-nodes',
        name: t("controls.selectAllNodes"),
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const graphView = getActiveGraphView(plugin);
            if (graphView && ExtendedGraphInstances.graphsManager.lifecycleManager.isPluginAlreadyEnabled(graphView)) {
                const instances = ExtendedGraphInstances.graphsManager.allInstances.get(graphView.leaf.id);
                if (!instances) {
                    return;
                }
                if (!checking) {
                    instances.nodesSet.selectNodes(instances.renderer.nodes);
                    instances.renderer.changed();
                }
                return true;
            }
        }
    });

    plugin.addCommand({
        id: 'invert-selection',
        name: t("controls.selectInvert"),
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const graphView = getActiveGraphView(plugin);
            if (graphView && ExtendedGraphInstances.graphsManager.lifecycleManager.isPluginAlreadyEnabled(graphView)) {
                const instances = ExtendedGraphInstances.graphsManager.allInstances.get(graphView.leaf.id);
                if (!instances || Object.keys(instances.nodesSet.selectedNodes).length === 0) {
                    return;
                }
                if (!checking) {
                    instances.nodesSet.invertSelection();
                    instances.renderer.changed();
                }
                return true;
            }
        }
    });
}

function addFocusCommands(plugin: ExtendedGraphPlugin) {
    plugin.addCommand({
        id: 'flicker-open-nodes',
        name: t("features.focusFlickerOpenNodes"),
        checkCallback: (checking: boolean) => {
            // Conditions to check
            if (ExtendedGraphInstances.graphsManager.allInstances.size > 0 && ExtendedGraphInstances.graphsManager.fileLeavesManager.openNodes.length > 0) {
                if (!checking) {
                    for (const instances of ExtendedGraphInstances.graphsManager.allInstances.values()) {
                        for (const id of ExtendedGraphInstances.graphsManager.fileLeavesManager.openNodes) {
                            instances.nodesSet.extendedElementsMap.get(id)?.flicker();
                        }
                    }
                }
                return true;
            }
        }
    });

    plugin.addCommand({
        id: 'flicker-search-nodes',
        name: t("features.focusFlickerSearchNodes"),
        checkCallback: (checking: boolean) => {
            // Conditions to check
            const searchResults = ExtendedGraphInstances.graphsManager.searchLeavesManager.getSearchResults();
            if (ExtendedGraphInstances.graphsManager.allInstances.size > 0 && searchResults.length > 0) {
                if (!checking) {
                    for (const instances of ExtendedGraphInstances.graphsManager.allInstances.values()) {
                        for (const id of searchResults) {
                            instances.nodesSet.extendedElementsMap.get(id)?.flicker();
                        }
                    }
                }
                return true;
            }
        }
    });
}