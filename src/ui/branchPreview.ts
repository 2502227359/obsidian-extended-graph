import { Component } from "obsidian";
import type { GraphInstances } from "../pluginInstances";
import type { BranchEdge, NeighborBranch } from "../relations/neighbors";
import { PreviewLayer } from "../graph/previewLayer";
import type { PreviewCallbacks } from "../graph/previewLayer";
import { nodeLabel } from "./nodeLabels";
import { pathParse } from "../helpers/path";
import { PreviewLayout } from "./previewLayout";

export type { PreviewCallbacks, PreviewRegion } from "../graph/previewLayer";

interface Point {
    x: number;
    y: number;
}

interface PreviewState {
    page: number;
    pages: number;
    retained: boolean;
}

/** 与主图临时层共享数据的局部关系小图。 */
export class BranchPreviewView extends Component {
    private readonly layer: PreviewLayer;
    private readonly layoutManager: PreviewLayout;
    private root?: HTMLDivElement;
    private svg?: SVGSVGElement;
    private branch?: NeighborBranch;
    private trail: string[] = [];
    private trailEdges: BranchEdge[] = [];
    private includeSources = false;
    private page = 1;
    private pages = 1;
    private retained = false;
    private alpha = 0;
    private placementKey = "";
    private titleExpanded = false;
    private titleWidth = 0;
    private name?: HTMLDivElement;
    private titleToggle?: HTMLButtonElement;

    constructor(private readonly instances: GraphInstances, private readonly callbacks: PreviewCallbacks) {
        super();
        this.layer = new PreviewLayer(instances, callbacks);
        this.layoutManager = this.addChild(new PreviewLayout(instances, callbacks));
    }

    override onload(): void {
        this.ensureRoot();
    }

    show(branch: NeighborBranch, trail: string[], trailEdges: BranchEdge[], includeSources: boolean, state: PreviewState): void {
        if (this.branch?.anchor !== branch.anchor) this.titleExpanded = false;
        this.branch = branch;
        this.trail = [...trail];
        this.trailEdges = [...trailEdges];
        this.includeSources = includeSources;
        this.page = state.page;
        this.pages = state.pages;
        this.retained = state.retained;
        this.ensureRoot();
        this.renderPanel();
        this.layer.show(branch, trail, trailEdges);
        if (this.root) {
            this.root.hidden = false;
            this.root.style.opacity = String(this.alpha);
            this.root.style.pointerEvents = "auto";
            this.root.classList.add("is-visible");
        }
    }

    frame(alpha: number): void {
        const value = Math.max(0, Math.min(1, alpha));
        this.alpha = value;
        this.layer.frame(value);
        if (this.root) {
            this.root.style.opacity = String(value);
            this.root.style.pointerEvents = value > 0.01 ? "auto" : "none";
            this.positionPanel();
            this.updateTitleOverflow();
        }
    }

    onCSSChange(): void {
        this.layer.onCSSChange();
    }

    hitNode(event: MouseEvent): { path: string; edge?: BranchEdge } | undefined {
        return this.layer.hitNode(event);
    }

    hitCoreNode(event: MouseEvent): boolean {
        return this.layer.hitCoreNode(event);
    }

    moveNode(path: string, from: MouseEvent, to: MouseEvent): void {
        this.layer.moveNode(path, from, to);
    }

    hitEdge(event: MouseEvent): BranchEdge | undefined {
        return this.layer.hitEdge(event);
    }

    clear(): void {
        this.layoutManager.cancelDrag();
        this.restoreRelationsHeight();
        this.layer.clear();
        this.branch = undefined;
        this.trail = [];
        this.trailEdges = [];
        this.page = 1;
        this.pages = 1;
        this.retained = false;
        if (this.root) {
            this.root.hidden = true;
            this.root.style.opacity = "0";
            this.root.style.pointerEvents = "none";
            this.root.classList.remove("is-visible");
            this.empty(this.root);
        }
        this.svg = undefined;
        this.alpha = 0;
        this.placementKey = "";
    }

    override onunload(): void {
        this.clear();
        this.root?.remove();
        this.root = undefined;
    }

    private ensureRoot(): void {
        if (this.root) return;
        this.root = document.createElement("div");
        this.root.className = "eg-branch-preview";
        this.root.hidden = true;
        this.root.setAttribute("role", "region");
        this.root.setAttribute("aria-label", "悬浮关联预览");
        this.root.addEventListener("pointerenter", () => this.callbacks.hold("mini"));
        this.root.addEventListener("pointerleave", () => {
            if (this.layoutManager.dragging) return;
            if (!this.root?.contains(this.root.ownerDocument.activeElement)) this.callbacks.leave("mini");
        });
        this.root.addEventListener("focusin", () => this.callbacks.hold("mini"));
        this.root.addEventListener("focusout", event => {
            const next = event.relatedTarget as Node | null;
            if (!(next?.nodeType && this.root?.contains(next)) && !this.root?.matches(":hover")) this.callbacks.leave("mini");
        });
        this.root.addEventListener("pointerdown", event => event.stopPropagation());
        this.root.addEventListener("contextmenu", event => event.stopPropagation());
        this.instances.view.contentEl.appendChild(this.root);
        this.layoutManager.attach(this.root);
    }

    private renderPanel(): void {
        if (!this.root || !this.branch) return;
        this.empty(this.root);
        this.root.hidden = false;
        this.root.dataset.anchor = this.branch.anchor;
        this.root.dataset.total = String(this.branch.total);
        this.root.dataset.hidden = String(this.branch.hidden);
        this.root.dataset.includeSources = String(this.includeSources);
        this.root.dataset.page = String(this.page);
        this.root.dataset.pages = String(this.pages);
        this.root.dataset.retained = String(this.retained);
        this.root.classList.toggle("is-dense", this.branch.nodes.length > 9);

        const header = this.root.createDiv({ cls: "eg-branch-preview-header" });
        header.addEventListener("pointerdown", event => this.layoutManager.startDrag(event));
        header.createEl("strong", { text: "关联预览" });
        header.createDiv({ cls: "eg-branch-preview-count", text: this.countText() });
        this.renderTrail();
        this.renderTitle();
        this.svg = this.createSvg();
        this.root.appendChild(this.svg);
        this.renderControls();
        this.renderSvgNodes();
    }

    private renderTrail(): void {
        if (!this.root || !this.branch) return;
        const paths = this.trail.filter(path => path !== this.branch!.anchor);
        const trailEl = this.root.createDiv({ cls: "eg-branch-preview-trail", attr: { "aria-label": "探索路径，点击返回祖先" } });
        if (!paths.length) { trailEl.createSpan({ text: "探索起点" }); return; }
        paths.forEach((path, index) => {
            if (index > 0) trailEl.createSpan({ text: " › " });
            const button = trailEl.createEl("button", { cls: "eg-branch-preview-trail-path", text: this.displayName(path) });
            button.type = "button";
            button.dataset.path = path;
            button.title = path;
            button.dataset.trailIndex = String(index);
            button.addEventListener("click", event => {
                event.preventDefault();
                this.callbacks.enter(path, event, "mini");
            });
        });
    }

    private renderTitle(): void {
        if (!this.root || !this.branch) return;
        const title = this.root.createDiv({ cls: "eg-branch-preview-title" });
        this.name = title.createDiv({ cls: "eg-branch-preview-name", text: pathParse(this.branch.anchor).basename });
        this.name.title = this.branch.anchor;
        this.name.classList.toggle("is-expanded", this.titleExpanded);
        this.titleToggle = title.createEl("button", {
            cls: "eg-branch-preview-title-toggle", text: this.titleExpanded ? "收起全文" : "展开全文",
            attr: { type: "button", "aria-expanded": String(this.titleExpanded) },
        });
        this.titleToggle.hidden = true;
        this.titleWidth = 0;
        this.titleToggle.addEventListener("click", () => {
            this.titleExpanded = !this.titleExpanded;
            this.name!.classList.toggle("is-expanded", this.titleExpanded);
            this.titleToggle!.setAttribute("aria-expanded", String(this.titleExpanded));
            this.titleToggle!.setText(this.titleExpanded ? "收起全文" : "展开全文");
            this.titleWidth = 0;
            this.instances.renderer.changed();
        });
    }

    private updateTitleOverflow(): void {
        if (!this.name || !this.titleToggle || this.name.clientWidth === this.titleWidth) return;
        this.titleWidth = this.name.clientWidth;
        this.titleToggle.hidden = !this.titleExpanded && this.name.scrollHeight <= this.name.clientHeight + 1;
    }

    private createSvg(): SVGSVGElement {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("eg-branch-preview-svg");
        svg.setAttribute("viewBox", "0 0 320 270");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", "局部关联图");
        const defs = document.createElementNS(svg.namespaceURI, "defs");
        const marker = document.createElementNS(svg.namespaceURI, "marker");
        marker.setAttribute("id", `eg-preview-arrow-${this.instances.view.leaf.id}`);
        for (const [key, value] of Object.entries({ viewBox: "0 0 10 10", refX: "20", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto" })) marker.setAttribute(key, value);
        const arrow = document.createElementNS(svg.namespaceURI, "path");
        arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 Z");
        marker.appendChild(arrow);
        defs.appendChild(marker);
        svg.appendChild(defs);
        return svg;
    }

    private renderControls(): void {
        if (!this.root) return;
        const controls = this.root.createDiv({ cls: "eg-branch-preview-controls" });
        if (this.pages > 1) {
            this.addButton(controls, "上一批", "page-prev", () => this.callbacks.page(-1), this.page <= 1);
            this.addButton(controls, "下一批", "page-next", () => this.callbacks.page(1), this.page >= this.pages);
            const indicator = controls.createDiv({ cls: "eg-branch-preview-page", text: `第 ${this.page} / ${this.pages} 页` });
            indicator.dataset.pageIndicator = "true";
        }
        this.addButton(controls, this.retained ? "已保留" : "保留这一层", "retain", () => this.callbacks.retain(), this.retained);
        this.addButton(controls, this.includeSources ? "隐藏来源" : "显示来源", "sources", () => this.callbacks.toggleSources());
    }

    private addButton(parent: HTMLElement, text: string, action: string, callback: () => void, disabled = false): void {
        const button = parent.createEl("button", { cls: "eg-branch-preview-action", text });
        button.type = "button";
        button.dataset.action = action;
        button.disabled = disabled;
        button.setAttribute("aria-disabled", String(disabled));
        button.addEventListener("click", event => {
            event.preventDefault();
            callback();
        });
    }

    private renderSvgNodes(): void {
        if (!this.svg || !this.branch) return;
        const paths = this.uniquePaths([...this.trail, ...this.branch.nodes]);
        const positions = this.layout(paths);
        for (const edge of this.uniqueEdges([...this.trailEdges, ...this.branch.edges])) {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) continue;
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.classList.add("eg-branch-preview-edge");
            line.dataset.source = edge.source;
            line.dataset.target = edge.target;
            line.setAttribute("marker-end", `url(#eg-preview-arrow-${this.instances.view.leaf.id})`);
            this.setLine(line, source, target);
            line.addEventListener("contextmenu", event => {
                event.preventDefault();
                this.callbacks.relations(edge.source, edge.target);
            });
            this.svg.appendChild(line);
        }
        for (const path of paths) this.renderSvgNode(path, positions.get(path));
    }

    private renderSvgNode(path: string, position?: Point): void {
        if (!this.svg || !position || !this.branch) return;
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.classList.add("eg-branch-preview-node");
        group.dataset.path = path;
        group.setAttribute("tabindex", "0");
        group.setAttribute("role", "button");
        group.setAttribute("aria-label", path);
        group.setAttribute("transform", `translate(${position.x} ${position.y})`);

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", path === this.branch.anchor ? "15" : "12");
        group.appendChild(circle);
        const label = this.createNodeLabel(path);
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = path;
        group.appendChild(title);
        group.classList.toggle("is-anchor", path === this.branch.anchor);
        group.appendChild(label);
        this.bindNode(group, path);
        this.svg.appendChild(group);
    }

    private createNodeLabel(path: string): SVGTextElement {
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        const name = Array.from(this.displayName(path));
        for (let offset = 0; offset < name.length; offset += 8) {
            const line = document.createElementNS(label.namespaceURI, "tspan");
            line.setAttribute("x", "0");
            line.setAttribute("dy", offset ? "14" : "0");
            line.textContent = name.slice(offset, offset + 8).join("");
            label.appendChild(line);
        }
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dy", "29");
        return label;
    }

    private bindNode(group: SVGGElement, path: string): void {
        group.addEventListener("pointerenter", event => this.callbacks.enter(path, event, "mini"));
        group.addEventListener("click", event => {
            if (event.button !== 0) return;
            this.callbacks.open(path, event);
        });
        group.addEventListener("contextmenu", event => {
            event.preventDefault();
            const edge = this.getRelationEdge(path);
            if (edge) this.callbacks.relations(edge.source, edge.target);
        });
        group.addEventListener("keydown", event => {
            if (!["Enter", " "].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.repeat) return;
            const bounds = group.getBoundingClientRect();
            this.callbacks.open(path, new MouseEvent("click", {
                button: 0, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2,
                altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
            }));
        });
    }

    private layout(paths: string[]): Map<string, Point> {
        const positions = new Map<string, Point>();
        const anchor = this.branch?.anchor ?? paths[0];
        if (anchor) positions.set(anchor, { x: 160, y: 125 });
        const others = paths.filter(path => path !== anchor);
        const radius = Math.min(85, Math.max(58, 35 + others.length * 8));
        others.forEach((path, index) => {
            const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, others.length);
            positions.set(path, { x: 160 + Math.cos(angle) * radius, y: 125 + Math.sin(angle) * radius });
        });
        return positions;
    }

    getRelationEdge(path: string): BranchEdge | undefined {
        const edges = this.uniqueEdges([...(this.trailEdges ?? []), ...(this.branch?.edges ?? [])]);
        return edges.find(edge => edge.source === this.branch?.anchor && edge.target === path)
            ?? edges.find(edge => edge.target === this.branch?.anchor && edge.source === path)
            ?? edges.find(edge => edge.source === path || edge.target === path);
    }

    private setLine(line: SVGLineElement, source: Point, target: Point): void {
        line.setAttribute("x1", String(source.x));
        line.setAttribute("y1", String(source.y));
        line.setAttribute("x2", String(target.x));
        line.setAttribute("y2", String(target.y));
    }

    private countText(): string {
        if (!this.branch) return "";
        const hidden = this.branch.hidden > 0 ? ` · 来源隐藏 ${this.branch.hidden}` : "";
        return `显示 ${this.branch.nodes.length - 1} / ${this.branch.total} 个关联${hidden}`;
    }

    private empty(element: HTMLElement): void {
        while (element.firstChild) element.removeChild(element.firstChild);
    }

    private uniquePaths(paths: string[]): string[] {
        return [...new Set(paths.filter(Boolean))];
    }

    private uniqueEdges(edges: BranchEdge[]): BranchEdge[] {
        const seen = new Set<string>();
        return edges.filter(edge => {
            const key = `${edge.source}\u0000${edge.target}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    private displayName(path: string): string {
        return nodeLabel(path, this.uniquePaths([...this.trail, ...(this.branch?.nodes ?? [])]), 14);
    }

    private positionPanel(): void {
        if (!this.root || !this.branch || this.root.hidden) return;
        const bounds = this.instances.view.contentEl.getBoundingClientRect();
        const panel = this.instances.view.contentEl.querySelector<HTMLElement>(".eg-relations-panel");
        const blocker = panel?.getBoundingClientRect();
        const key = `${bounds.width}:${bounds.height}:${blocker?.left ?? 0}:${blocker?.width ?? 0}:${blocker?.height ?? 0}`;
        if (this.placementKey === key) {
            if (this.layoutManager.restorePosition()) return;
            const top = Number.parseFloat(this.root.style.top) || 12;
            const next = Math.min(top, Math.max(12, bounds.height - this.root.offsetHeight - 12));
            if (next !== top) this.root.style.top = `${next}px`;
            return;
        }
        if (panel && blocker && blocker.left - bounds.left - 24 < 260) {
            this.stackPanels(panel, bounds);
            this.placementKey = key;
            return;
        }
        this.root.classList.remove("is-stacked");
        this.root.style.removeProperty("max-height");
        this.restoreRelationsHeight();
        const width = Math.min(340, bounds.width - 88, blocker ? blocker.left - bounds.left - 24 : 340);
        this.root.style.width = `${Math.max(160, width)}px`;
        const height = Math.min(this.root.offsetHeight, bounds.height - 24);
        let left = bounds.width - width - 64;
        if (blocker) left = Math.min(left, blocker.left - bounds.left - width - 12);
        this.root.style.left = `${Math.max(12, Math.min(bounds.width - width - 12, left))}px`;
        this.root.style.top = `${Math.max(12, Math.min(bounds.height - height - 12, 52))}px`;
        this.layoutManager.restorePosition();
        this.placementKey = key;
    }

    private stackPanels(panel: HTMLElement, bounds: DOMRect): void {
        if (!this.root) return;
        const available = Math.max(120, bounds.height - 76);
        const height = Math.min(360, available * 0.5);
        this.root.classList.add("is-stacked");
        panel.style.maxHeight = `${available - height - 12}px`;
        const width = Math.min(420, Math.max(0, bounds.width - 24));
        this.root.style.width = `${width}px`;
        this.root.style.maxHeight = `${height}px`;
        this.root.style.left = `${Math.max(12, bounds.width - width - 12)}px`;
        this.root.style.top = `${panel.getBoundingClientRect().bottom - bounds.top + 12}px`;
    }

    private restoreRelationsHeight(): void {
        this.instances.view.contentEl.querySelector<HTMLElement>(".eg-relations-panel")?.style.removeProperty("max-height");
    }
}
