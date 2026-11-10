import { Component } from "obsidian";
import type { GraphInstances } from "../pluginInstances";
import type { BranchEdge, NeighborBranch } from "../relations/neighbors";
import { PreviewLayer } from "../graph/previewLayer";
import type { PreviewCallbacks } from "../graph/previewLayer";

export type { PreviewCallbacks, PreviewRegion } from "../graph/previewLayer";

interface Point {
    x: number;
    y: number;
}

/** 与主图临时层共享数据的局部关系小图。 */
export class BranchPreviewView extends Component {
    private readonly layer: PreviewLayer;
    private root?: HTMLDivElement;
    private svg?: SVGSVGElement;
    private branch?: NeighborBranch;
    private trail: string[] = [];
    private trailEdges: BranchEdge[] = [];
    private includeSources = false;
    private alpha = 0;
    private placementKey = "";

    constructor(private readonly instances: GraphInstances, private readonly callbacks: PreviewCallbacks) {
        super();
        this.layer = new PreviewLayer(instances, callbacks);
    }

    override onload(): void {
        this.ensureRoot();
    }

    show(branch: NeighborBranch, trail: string[], trailEdges: BranchEdge[], includeSources: boolean): void {
        this.branch = branch;
        this.trail = [...trail];
        this.trailEdges = [...trailEdges];
        this.includeSources = includeSources;
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
        }
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
        this.layer.clear();
        this.branch = undefined;
        this.trail = [];
        this.trailEdges = [];
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
        this.root.addEventListener("pointerleave", () => this.callbacks.leave("mini"));
        this.root.addEventListener("pointerdown", event => event.stopPropagation());
        this.root.addEventListener("contextmenu", event => event.stopPropagation());
        this.instances.view.contentEl.appendChild(this.root);
    }

    private renderPanel(): void {
        if (!this.root || !this.branch) return;
        this.empty(this.root);
        this.root.hidden = false;
        this.root.dataset.anchor = this.branch.anchor;
        this.root.dataset.total = String(this.branch.total);
        this.root.dataset.hidden = String(this.branch.hidden);
        this.root.dataset.includeSources = String(this.includeSources);
        this.root.classList.toggle("is-dense", this.branch.nodes.length > 9);

        const header = this.root.createDiv({ cls: "eg-branch-preview-header" });
        header.createEl("strong", { text: "关联预览" });
        header.createDiv({ cls: "eg-branch-preview-count", text: this.countText() });
        this.renderTrail();
        this.svg = this.createSvg();
        this.root.appendChild(this.svg);
        this.renderControls();
        this.renderSvgNodes();
    }

    private renderTrail(): void {
        if (!this.root || !this.branch) return;
        const trailEl = this.root.createDiv({ cls: "eg-branch-preview-trail" });
        const paths = this.trail.length ? this.trail : [this.branch.anchor];
        paths.forEach((path, index) => {
            if (index > 0) trailEl.createSpan({ text: " › " });
            const button = trailEl.createEl("button", { cls: "eg-branch-preview-trail-path", text: this.displayName(path) });
            button.type = "button";
            button.dataset.path = path;
            button.dataset.trailIndex = String(index);
            button.addEventListener("click", event => {
                event.preventDefault();
                this.callbacks.enter(path, event, "mini");
            });
        });
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
        this.addButton(controls, "上一批", "page-prev", () => this.callbacks.page(-1));
        this.addButton(controls, "下一批", "page-next", () => this.callbacks.page(1));
        this.addButton(controls, "保留这一层", "retain", () => this.callbacks.retain());
        this.addButton(controls, this.includeSources ? "隐藏来源" : "显示来源", "sources", () => this.callbacks.toggleSources());
    }

    private addButton(parent: HTMLElement, text: string, action: string, callback: () => void): void {
        const button = parent.createEl("button", { cls: "eg-branch-preview-action", text });
        button.type = "button";
        button.dataset.action = action;
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
        group.setAttribute("transform", `translate(${position.x} ${position.y})`);

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", path === this.branch.anchor ? "15" : "12");
        group.appendChild(circle);
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.textContent = this.displayName(path);
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = path;
        group.appendChild(title);
        group.classList.toggle("is-anchor", path === this.branch.anchor);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dy", "29");
        group.appendChild(label);
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
        this.svg.appendChild(group);
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
        const name = (path.split(/[\\/]/).pop() ?? path).replace(/\.md$/, "");
        return Array.from(name).length > 10 ? Array.from(name).slice(0, 10).join("") + "…" : name;
    }

    private positionPanel(): void {
        if (!this.root || !this.branch || this.root.hidden) return;
        const bounds = this.instances.view.contentEl.getBoundingClientRect();
        const point = this.layer.screenPosition(this.branch.anchor);
        if (!point) return;
        const blocker = this.instances.view.contentEl.querySelector(".eg-relations-panel")?.getBoundingClientRect();
        const key = `${bounds.width}:${bounds.height}:${blocker?.left ?? 0}:${blocker?.width ?? 0}`;
        if (this.placementKey === key) return;
        const width = Math.min(340, bounds.width - 24, blocker ? Math.max(220, blocker.left - bounds.left - 24) : 340);
        this.root.style.width = `${Math.max(160, width)}px`;
        const height = Math.min(this.root.offsetHeight, bounds.height - 24);
        let left = point.x - bounds.left + 24;
        if (left + width > bounds.width - 12) left = point.x - bounds.left - width - 24;
        if (blocker) left = Math.min(left, blocker.left - bounds.left - width - 12);
        this.root.style.left = `${Math.max(12, Math.min(bounds.width - width - 12, left))}px`;
        this.root.style.top = `${Math.max(12, Math.min(bounds.height - height - 12, point.y - bounds.top - 40))}px`;
        this.placementKey = key;
    }
}
