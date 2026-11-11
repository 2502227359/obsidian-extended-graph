import { Component, ExtraButtonComponent, Notice, TFile } from "obsidian";
import { GraphData, GraphRenderer, LocalGraphView } from "obsidian-typings";
import { ExtendedGraphInstances, GraphInstances } from "../pluginInstances";
import { BranchEdge, NeighborBranch, NeighborOptions } from "../relations/neighbors";
import { BranchPreviewView } from "../ui/branchPreview";
import { BranchExpansions } from "./branchExpansions";
import { holdCenter } from "./centerPin";

type Region = "core" | "main" | "mini" | "note";

interface PreviewDrag {
    path: string;
    pointerId: number;
    start: PointerEvent;
    last: PointerEvent;
    moved: boolean;
}

/** 当前局部图谱的手动分支、悬浮会话及原生预览分流。 */
export class BranchExplorer extends Component {
    readonly expansions = new BranchExpansions();
    enabled = false;
    private index = ExtendedGraphInstances.plugin.neighborIndex;
    private preview: BranchPreviewView;
    private toggleEl: HTMLElement;
    private tools: HTMLElement;
    private base?: GraphData;
    private rootPath = "";
    private branch?: NeighborBranch;
    private trail: string[] = [];
    private trailEdges: BranchEdge[] = [];
    private page = 0;
    private includeSources = false;
    private regions = new Set<Region>();
    private enterTimer?: number;
    private leaveTimer?: number;
    private candidate = "";
    private lastHover?: { event: MouseEvent; path: string; region: Region };
    private oldHover: GraphRenderer["onNodeHover"];
    private oldUnhover: GraphRenderer["onNodeUnhover"];
    private hoverWrapper: GraphRenderer["onNodeHover"];
    private unhoverWrapper: GraphRenderer["onNodeUnhover"];
    private releaseCenter?: () => void;
    private alpha = 0;
    private fadeFrom = 0;
    private fadeTo = 0;
    private fadeStarted = 0;
    private fadeDuration = 0;
    private cleanupTimer?: number;
    private noteMode = false;
    private noteElement?: HTMLElement;
    private noteEnter = () => this.hold("note");
    private noteLeave = () => this.leave("note");
    private pointerPoint?: { x: number; y: number };
    private layoutPoint?: { x: number; y: number };
    private blockedHover?: { path: string; region: Region };
    private pendingSync = false;
    private drag?: PreviewDrag;
    private canvasTitle?: string | null;

    constructor(private instances: GraphInstances) {
        super();
        this.preview = this.addChild(new BranchPreviewView(instances, {
            enter: (path, event, region = "main") => this.enter(path, event, region),
            leave: (region = "main") => this.leave(region),
            hold: region => this.hold(region),
            retain: () => this.keepPreview(),
            relations: (source, target) => instances.graphEventsDispatcher.inputsManager.showRelations(target, source),
            open: (path, event) => { void this.open(path, event); },
            page: delta => this.changePage(delta),
            toggleSources: () => this.toggleSources(),
        }));
    }

    override onload(): void {
        this.rootPath = this.currentRoot();
        this.enableCanvasFocus();
        this.tools = this.instances.view.contentEl.createDiv({ cls: "eg-local-tools" });
        this.toggleEl = new ExtraButtonComponent(this.tools).setIcon("network")
            .setTooltip("悬浮关联预览：关闭").onClick(() => this.toggle()).extraSettingsEl;
        this.toggleEl.addClass("eg-hover-branches-toggle");
        this.toggleEl.setAttribute("role", "button");
        this.toggleEl.tabIndex = 0;
        this.registerDomEvent(this.toggleEl, "keydown", event => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.toggle(); }
        });
        this.updateToggle();
        this.bindHover();
        const win = this.instances.view.containerEl.win;
        this.registerDomEvent(win, "keydown", event => this.onModifier(event));
        this.registerDomEvent(win, "keyup", event => this.onModifier(event));
        this.registerDomEvent(win, "blur", () => this.clearPreview());
        this.registerDomEvent(win, "pointermove", event => this.onPointerMove(event), true);
        this.registerDomEvent(win, "pointerup", event => this.onPointerUp(event), true);
        this.registerDomEvent(win, "pointercancel", event => {
            if (this.drag?.pointerId === event.pointerId) this.clearPreview();
        }, true);
        this.registerDomEvent(this.instances.renderer.interactiveEl, "pointerdown", event => this.onCanvasDown(event), true);
        this.registerDomEvent(this.instances.renderer.interactiveEl, "contextmenu", event => {
            if (!this.preview.hitNode(event) && !this.preview.hitEdge(event)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
        this.registerDomEvent(this.instances.renderer.interactiveEl, "wheel", () => this.clearPreview(), true);
        const app = ExtendedGraphInstances.app;
        this.registerEvent(app.metadataCache.on("resolved", () => this.refreshData()));
        this.registerEvent(app.vault.on("rename", () => this.reset()));
        this.registerEvent(app.vault.on("delete", () => this.refreshData()));
    }

    private enableCanvasFocus(): void {
        const canvas = this.instances.renderer.interactiveEl;
        const tabIndex = canvas.getAttribute("tabindex");
        canvas.tabIndex = 0;
        this.register(() => {
            if (tabIndex === null) canvas.removeAttribute("tabindex");
            else canvas.setAttribute("tabindex", tabIndex);
        });
    }

    private bindHover(): void {
        const renderer = this.instances.renderer;
        this.oldHover = renderer.onNodeHover;
        this.oldUnhover = renderer.onNodeUnhover;
        this.hoverWrapper = (event, path, type) => {
            if (!this.enabled || type === "tag" || path === this.currentRoot()) {
                this.oldHover.call(renderer, event, path, type);
                return;
            }
            this.enter(path, event, "core");
        };
        this.unhoverWrapper = () => {
            this.oldUnhover.call(renderer);
            this.leave("core");
        };
        renderer.onNodeHover = this.hoverWrapper;
        renderer.onNodeUnhover = this.unhoverWrapper;
    }

    toggle(): void {
        this.enabled = !this.enabled;
        this.clearPreview();
        this.preview.setEnabled(this.enabled);
        this.oldUnhover?.call(this.instances.renderer);
        this.updateToggle();
    }

    private updateToggle(): void {
        this.toggleEl.setAttribute("aria-pressed", String(this.enabled));
        this.toggleEl.setAttribute("aria-label", `悬浮关联：${this.enabled ? "开启；Ctrl 悬浮预览笔记" : "关闭"}`);
        this.toggleEl.classList.toggle("is-active", this.enabled);
    }

    private enter(path: string, event: MouseEvent, region: Region): void {
        if (this.drag || !this.enabled || !this.isAllowed(path)) return;
        this.regions.add(region);
        window.clearTimeout(this.leaveTimer);
        this.lastHover = { event, path, region };
        this.pointerPoint = { x: event.clientX, y: event.clientY };
        if (event.ctrlKey || event.metaKey) { this.showNote(event, path); return; }
        this.noteMode = false;
        if (this.isLayoutHover(path, event)) { this.blockedHover = { path, region }; return; }
        if (this.candidate === path) return;
        this.candidate = path;
        window.clearTimeout(this.enterTimer);
        if (this.branch?.anchor === path) { this.fade(1); return; }
        this.enterTimer = window.setTimeout(() => {
            if (this.enabled && this.candidate === path) this.explore(path);
        }, 300);
    }

    private leave(region: Region): void {
        if (this.drag) return;
        this.regions.delete(region);
        if (this.lastHover?.region === region) this.lastHover = undefined;
        if (this.regions.size) return;
        this.candidate = "";
        window.clearTimeout(this.enterTimer);
        window.clearTimeout(this.leaveTimer);
        this.leaveTimer = window.setTimeout(() => {
            if (!this.regions.size && !this.noteUnderPointer()) this.fade(0);
        }, 200);
    }

    private hold(region: Region): void {
        this.regions.add(region);
        window.clearTimeout(this.leaveTimer);
        if (this.branch) this.fade(1);
    }

    private isLayoutHover(path: string, event: MouseEvent): boolean {
        if (!this.layoutPoint || this.branch?.anchor === path || event.type === "click") return false;
        return Math.hypot(event.clientX - this.layoutPoint.x, event.clientY - this.layoutPoint.y) < 3;
    }

    private onPointerMove(event: PointerEvent): void {
        this.updatePointerTitle(event);
        this.pointerPoint = { x: event.clientX, y: event.clientY };
        if (this.drag) { this.moveDrag(event); return; }
        const blocked = this.blockedHover;
        if (!blocked || this.isLayoutHover(blocked.path, event)) return;
        const target = event.target as Element | null;
        const path = typeof target?.closest === "function" ? target.closest("[data-path]")?.getAttribute("data-path") : undefined;
        const mainPath = this.preview.hitNode(event)?.path ?? this.instances.renderer.getHighlightNode()?.id;
        this.blockedHover = undefined;
        if (path === blocked.path || mainPath === blocked.path) this.enter(blocked.path, event, blocked.region);
    }

    private updatePointerTitle(event: PointerEvent): void {
        const canvas = this.instances.renderer.interactiveEl;
        const path = event.target === canvas ? this.preview.hitNode(event)?.path : undefined;
        if (!path) { this.restorePointerTitle(); return; }
        if (this.canvasTitle === undefined) this.canvasTitle = canvas.getAttribute("title");
        canvas.title = path;
    }

    private restorePointerTitle(): void {
        if (this.canvasTitle === undefined) return;
        const canvas = this.instances.renderer.interactiveEl;
        if (this.canvasTitle === null) canvas.removeAttribute("title");
        else canvas.title = this.canvasTitle;
        this.canvasTitle = undefined;
    }

    private explore(path: string): void {
        if (!this.releaseCenter) this.releaseCenter = holdCenter(this.instances.view.leaf);
        const previous = this.trail.indexOf(path);
        if (previous >= 0) this.trail = this.trail.slice(0, previous + 1);
        else if (this.branch?.nodes.includes(path)) this.trail.push(path);
        else this.trail = [path];
        this.page = 0;
        this.drawBranch();
        this.fade(1);
    }

    private drawBranch(): void {
        if (this.noteMode) return;
        const focus = this.trail[this.trail.length - 1];
        if (!focus) return;
        const branch = this.queryBranch(focus);
        const page = this.clampPage(branch.total);
        const pageChanged = page !== this.page;
        this.page = page;
        this.branch = pageChanged ? this.queryBranch(focus) : branch;
        this.trailEdges = this.edgesAlongTrail();
        const regions = new Set(this.regions);
        this.layoutPoint = this.pointerPoint ? { ...this.pointerPoint } : undefined;
        this.blockedHover = undefined;
        this.preview.show(this.branch, this.trail, this.trailEdges, this.includeSources, {
            page: this.page + 1,
            pages: this.pageCount(this.branch.total),
            retained: this.expansions.anchors.has(this.branch.anchor),
        });
        this.regions = regions;
        this.instances.renderer.changed();
    }

    private pageCount(total: number): number {
        return Math.max(1, Math.ceil(total / 20));
    }

    private clampPage(total: number): number {
        return Math.max(0, Math.min(this.pageCount(total) - 1, this.page));
    }

    private edgesAlongTrail(): BranchEdge[] {
        const edges: BranchEdge[] = [];
        for (let i = 1; i < this.trail.length; ++i) {
            const previous = this.trail[i - 1], next = this.trail[i];
            const branch = this.queryBranch(previous, true);
            edges.push(...branch.edges.filter(edge =>
                (edge.source === previous && edge.target === next) || (edge.source === next && edge.target === previous)));
        }
        return edges;
    }

    private queryBranch(path: string, all = false): NeighborBranch {
        const branch = this.index.getOneHop(path, this.options());
        if (!branch.nodes.length) return branch;
        const nodes: GraphData["nodes"] = Object.fromEntries(branch.nodes.map(id => [id, { type: "", links: {} }]));
        for (const edge of branch.edges) nodes[edge.source].links[edge.target] = true;
        const filtered = this.instances.filter.filterData({ nodes, numLinks: branch.edges.length }, true);
        const edges = branch.edges.filter(edge => filtered.nodes[edge.source]?.links[edge.target] && filtered.nodes[edge.target]);
        const adjacent = new Set(edges.filter(edge => edge.source === path || edge.target === path)
            .flatMap(edge => [edge.source, edge.target]));
        const neighbors = branch.nodes.filter(id => id !== path && adjacent.has(id));
        const visible = all ? neighbors : neighbors.slice(this.page * 20, (this.page + 1) * 20);
        const included = new Set([path, ...visible]);
        return { ...branch, nodes: [...included], edges: edges.filter(edge => included.has(edge.source) && included.has(edge.target)), total: neighbors.length };
    }

    private options(): NeighborOptions {
        const options = this.instances.engine.getOptions();
        return {
            incoming: options.localBacklinks !== false,
            outgoing: options.localForelinks !== false,
            interlinks: !!options.localInterlinks,
            includeSources: this.includeSources,
            allowFile: path => this.isAllowed(path),
            limit: Number.MAX_SAFE_INTEGER,
            offset: 0,
        };
    }

    private isAllowed(path: string): boolean {
        const file = ExtendedGraphInstances.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || file.extension !== "md") return false;
        const engine = this.instances.engine;
        if (engine.hasFilter && !engine.fileFilter[path]) return false;
        return this.instances.filter.allowsFile(path);
    }

    mergeData(data: GraphData): GraphData {
        const root = this.currentRoot();
        if (root !== this.rootPath) { this.reset(); this.rootPath = root; }
        this.base = data;
        if (!this.expansions.anchors.size) return data;
        return this.expansions.compose(data, path => this.queryBranch(path, true));
    }

    toggleBranch(path: string): void {
        if (this.expansions.anchors.has(path)) this.expansions.toggle(path);
        else {
            this.expansions.keep(path, this.supportPath(path));
            if (!this.checkLimit()) { this.expansions.toggle(path); return; }
        }
        this.renderManual();
    }

    clearManual(): void {
        this.expansions.clear();
        this.renderManual();
    }

    get previewAnchor(): string | undefined {
        return this.noteMode ? undefined : this.branch?.anchor;
    }

    getHoveredNode(): string | undefined {
        return this.lastHover?.path ?? this.instances.renderer.getHighlightNode()?.id;
    }

    getPreviewNodes(): string[] {
        return this.previewAnchor ? [...new Set([...this.trail, ...this.branch!.nodes])] : [];
    }

    onCSSChange(): void {
        this.preview.onCSSChange();
    }

    keepPreview(): void {
        if (!this.branch) return;
        const anchor = this.branch.anchor;
        if (this.expansions.anchors.has(anchor)) return;
        this.expansions.keep(anchor, this.trailEdges);
        if (!this.checkLimit()) { this.expansions.toggle(anchor); return; }
        this.renderManual();
    }

    private supportPath(path: string): BranchEdge[] {
        const base = this.base ?? this.snapshot();
        if (base.nodes[path]) return [];
        const graph = this.expansions.compose(base, id => this.queryBranch(id, true));
        const adjacent = new Map<string, BranchEdge[]>();
        const edges = [
            ...Object.entries(graph.nodes).flatMap(([source, node]) => Object.keys(node.links).map(target => ({ source, target }))),
            ...this.trailEdges, ...(this.branch?.edges ?? []),
        ];
        for (const edge of edges) {
            for (const id of [edge.source, edge.target]) adjacent.set(id, [...(adjacent.get(id) ?? []), edge]);
        }
        const previous = new Map<string, { path: string; edge: BranchEdge }>();
        const queue = [path], visited = new Set(queue);
        for (let index = 0; index < queue.length; ++index) {
            const id = queue[index];
            if (base.nodes[id]) {
                const result: BranchEdge[] = [];
                for (let cursor = id; cursor !== path;) {
                    const step = previous.get(cursor)!;
                    result.push(step.edge); cursor = step.path;
                }
                return result;
            }
            for (const edge of adjacent.get(id) ?? []) {
                const next = edge.source === id ? edge.target : edge.source;
                if (visited.has(next)) continue;
                visited.add(next); previous.set(next, { path: id, edge }); queue.push(next);
            }
        }
        return [];
    }

    private checkLimit(): boolean {
        const projected = this.expansions.compose(this.base ?? this.snapshot(), path => this.queryBranch(path, true));
        const limit = this.instances.settings.maxNodes;
        if (Object.keys(projected.nodes).length <= limit) return true;
        new Notice(`展开将超过当前图谱的 ${limit} 个节点上限，请缩小分支或调整设置。`);
        return false;
    }

    private snapshot(): GraphData {
        const nodes: GraphData["nodes"] = {};
        for (const node of this.instances.renderer.nodes) nodes[node.id] = { type: node.type, links: {} };
        for (const link of this.instances.renderer.links) nodes[link.source.id].links[link.target.id] = true;
        return { nodes, numLinks: this.instances.renderer.links.length };
    }

    private renderManual(): void {
        this.pendingSync = true;
        this.instances.engine.render();
        if (this.branch) this.drawBranch();
    }

    private changePage(delta: number): void {
        if (!this.branch) return;
        this.page += delta;
        this.page = this.clampPage(this.branch.total);
        this.drawBranch();
    }

    toggleSources(): void {
        this.includeSources = !this.includeSources;
        if (this.expansions.anchors.size && !this.checkLimit()) {
            this.includeSources = !this.includeSources;
            return;
        }
        this.page = 0;
        if (this.expansions.anchors.size) this.renderManual();
        else this.drawBranch();
    }

    private onModifier(event: KeyboardEvent): void {
        if (this.drag || !this.enabled || !this.lastHover || !["Control", "Meta"].includes(event.key)) return;
        const { path, region } = this.lastHover;
        const mouse = this.lastHover.event;
        const previewEvent = new MouseEvent("mousemove", { clientX: mouse.clientX, clientY: mouse.clientY, ctrlKey: event.ctrlKey, metaKey: event.metaKey });
        if (event.ctrlKey || event.metaKey) this.showNote(previewEvent, path);
        else {
            this.oldUnhover.call(this.instances.renderer);
            this.candidate = "";
            this.enter(path, previewEvent, region);
        }
    }

    private showNote(event: MouseEvent, path: string): void {
        window.clearTimeout(this.enterTimer);
        this.candidate = "";
        this.noteMode = true;
        this.preview.clear();
        this.alpha = this.fadeTo = 0;
        if (!this.releaseCenter) this.releaseCenter = holdCenter(this.instances.view.leaf);
        this.oldHover.call(this.instances.renderer, event, path, "");
        this.watchNote();
    }

    private watchNote(): void {
        this.detachNote();
        const popover = this.instances.engine.hoverPopover as { hoverEl?: HTMLElement } | undefined;
        this.noteElement = popover?.hoverEl;
        this.noteElement?.addEventListener("pointerenter", this.noteEnter);
        this.noteElement?.addEventListener("pointerleave", this.noteLeave);
    }

    private detachNote(): void {
        this.noteElement?.removeEventListener("pointerenter", this.noteEnter);
        this.noteElement?.removeEventListener("pointerleave", this.noteLeave);
        this.noteElement = undefined;
    }

    private noteUnderPointer(): boolean {
        const popover = this.instances.engine.hoverPopover as { hoverEl?: HTMLElement } | undefined;
        return !!popover?.hoverEl?.matches(":hover");
    }

    private async open(path: string, event: MouseEvent): Promise<void> {
        if (event.altKey) {
            const edge = this.preview.getRelationEdge(path);
            const anchor = edge ? (edge.source === path ? edge.target : edge.source) : undefined;
            if (this.instances.graphEventsDispatcher.inputsManager.previewRelations(path, event, anchor)) {
                this.clearPreview();
                return;
            }
        }
        if (event.ctrlKey || event.metaKey) { this.showNote(event, path); return; }
        try {
            await ExtendedGraphInstances.app.workspace.openLinkText(path, this.currentRoot(), "tab");
        } catch (error) {
            new Notice("无法打开该笔记，请检查文件是否仍然存在。");
            console.error("打开分支笔记失败", error);
        } finally {
            this.clearPreview();
        }
    }

    private onCanvasDown(event: PointerEvent): void {
        if (!this.enabled) return;
        if (this.preview.hitCoreNode(event)) { this.clearPreview(); return; }
        const hit = this.preview.hitNode(event);
        const edge = hit?.edge ?? (event.button === 2 ? this.preview.hitEdge(event) : undefined);
        if (!hit && !edge) { this.clearPreview(); return; }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.button === 2 && edge) {
            this.instances.graphEventsDispatcher.inputsManager.showRelations(edge.target, edge.source);
        } else if (event.button === 0 && hit) {
            window.clearTimeout(this.enterTimer);
            this.candidate = "";
            this.hold("main");
            this.drag = { path: hit.path, pointerId: event.pointerId, start: event, last: event, moved: false };
        }
    }

    private moveDrag(event: PointerEvent): void {
        const drag = this.drag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.buttons) { this.clearPreview(); return; }
        drag.moved ||= Math.hypot(event.clientX - drag.start.clientX, event.clientY - drag.start.clientY) > 5;
        if (!drag.moved) return;
        this.preview.moveNode(drag.path, drag.last, event);
        drag.last = event;
        this.instances.renderer.changed();
    }

    private onPointerUp(event: PointerEvent): void {
        const drag = this.drag;
        if (!drag || drag.pointerId !== event.pointerId || event.button !== 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.drag = undefined;
        const bounds = this.instances.renderer.interactiveEl.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
            this.clearPreview();
            return;
        }
        const moved = drag.moved || Math.hypot(event.clientX - drag.start.clientX, event.clientY - drag.start.clientY) > 5;
        if (!moved) { void this.open(drag.path, event); return; }
        this.preview.moveNode(drag.path, drag.last, event);
        this.pointerPoint = this.layoutPoint = { x: event.clientX, y: event.clientY };
        this.hold("main");
    }

    private fade(to: number): void {
        window.clearTimeout(this.cleanupTimer);
        this.fadeFrom = this.alpha;
        this.fadeTo = to;
        this.fadeStarted = performance.now();
        const reduced = this.instances.view.containerEl.win.matchMedia("(prefers-reduced-motion: reduce)").matches;
        this.fadeDuration = reduced ? 0 : to ? 120 : 150;
        if (!to) this.cleanupTimer = window.setTimeout(() => {
            if (!this.fadeTo && !this.regions.size && !this.noteUnderPointer()) this.clearPreview();
        }, this.fadeDuration + 20);
        this.instances.renderer.changed();
    }

    frame(): void {
        this.syncManualElements();
        if (!this.enabled) return;
        const progress = this.fadeDuration ? Math.min(1, (performance.now() - this.fadeStarted) / this.fadeDuration) : 1;
        const eased = 1 - Math.pow(1 - progress, 3);
        this.alpha = this.fadeFrom + (this.fadeTo - this.fadeFrom) * eased;
        this.preview.frame(this.alpha);
        if (progress < 1) this.instances.renderer.changed();
        else if (!this.alpha && !this.regions.size && !this.noteUnderPointer()) this.clearPreview();
    }

    private syncManualElements(): void {
        if (!this.pendingSync || this.instances.graphEventsDispatcher.initTimeout !== undefined) return;
        if (this.instances.renderer.nodes.some(node => !node.circle)) return;
        this.pendingSync = false;
        this.instances.nodesSet.coreCollection = this.instances.renderer.nodes;
        this.instances.linksSet.coreCollection = this.instances.renderer.links;
        this.instances.nodesSet.load();
        this.instances.linksSet.load();
        this.instances.foldersSet?.load();
    }

    beforeGraphicsReset(): void {
        this.pendingSync ||= this.expansions.anchors.size > 0;
        this.clearPreview();
    }

    private refreshData(): void {
        for (const path of this.expansions.anchors) {
            if (!ExtendedGraphInstances.app.vault.getAbstractFileByPath(path)) this.expansions.toggle(path);
        }
        if (this.branch && !this.isAllowed(this.branch.anchor)) this.clearPreview();
        if (this.expansions.anchors.size) this.renderManual();
        else if (this.branch) this.drawBranch();
    }

    private currentRoot(): string {
        return (this.instances.view as LocalGraphView).file?.path ?? "";
    }

    private reset(): void {
        this.clearPreview();
        this.expansions.clear();
        this.pendingSync = false;
    }

    private clearPreview(): void {
        this.restorePointerTitle();
        this.drag = undefined;
        window.clearTimeout(this.enterTimer);
        window.clearTimeout(this.leaveTimer);
        window.clearTimeout(this.cleanupTimer);
        this.detachNote();
        this.noteMode = false;
        this.lastHover = undefined;
        this.blockedHover = undefined;
        this.layoutPoint = undefined;
        this.candidate = "";
        this.trail = [];
        this.trailEdges = [];
        this.branch = undefined;
        this.regions.clear();
        this.preview.clear();
        this.alpha = this.fadeFrom = this.fadeTo = 0;
        this.releaseCenter?.();
        this.releaseCenter = undefined;
    }

    override onunload(): void {
        this.clearPreview();
        const renderer = this.instances.renderer;
        if (renderer.onNodeHover === this.hoverWrapper) renderer.onNodeHover = this.oldHover;
        if (renderer.onNodeUnhover === this.unhoverWrapper) renderer.onNodeUnhover = this.oldUnhover;
        this.toggleEl?.remove();
        this.tools?.remove();
    }
}
