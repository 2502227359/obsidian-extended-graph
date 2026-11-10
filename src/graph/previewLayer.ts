import { Container, Graphics, Text } from "pixi.js";
import type { NeighborBranch, BranchEdge } from "../relations/neighbors";
import type { GraphInstances } from "../pluginInstances";

export type PreviewRegion = "main" | "mini";

export interface PreviewCallbacks {
    enter(path: string, event: MouseEvent, region?: PreviewRegion): void;
    leave(region?: PreviewRegion): void;
    hold(region: PreviewRegion): void;
    retain(): void;
    relations(source: string, target: string): void;
    open(path: string, event: MouseEvent): void;
    page(delta: number): void;
    toggleSources(): void;
}

interface Point {
    x: number;
    y: number;
}

interface PreviewNode {
    path: string;
    group: Container;
    label?: Text;
    ring?: Graphics;
    core: boolean;
}

interface PreviewEdge {
    edge: BranchEdge;
    graphic: Graphics;
}

/** 主图中的临时分支绘制层，不参与核心节点、边和力学数据。 */
export class PreviewLayer {
    private root?: Container;
    private nodes = new Map<string, PreviewNode>();
    private edges: PreviewEdge[] = [];
    private offsets = new Map<string, Point>();
    private anchor = "";
    private visiblePaths: string[] = [];
    private visibleEdges: BranchEdge[] = [];
    private alpha = 0;
    private anchorOrigin: Point = { x: 0, y: 0 };

    constructor(private readonly instances: GraphInstances, private readonly callbacks: PreviewCallbacks) { }

    show(branch: NeighborBranch, trail: string[], trailEdges: BranchEdge[]): void {
        const previous = new Map([...this.nodes].map(([path, node]) => [path, { x: node.group.x, y: node.group.y }]));
        const origin = this.corePosition(branch.anchor) ?? previous.get(branch.anchor) ?? { x: 0, y: 0 };
        this.clear();
        this.ensureRoot();
        this.anchor = branch.anchor;
        this.anchorOrigin = origin;
        this.visiblePaths = this.uniquePaths([branch.anchor, ...trail, ...branch.nodes]);
        this.visibleEdges = this.uniqueEdges([...trailEdges, ...branch.edges]);
        this.buildNodes(previous);
        this.buildEdges();
        this.updatePositions();
        this.alpha = 0;
        if (this.root) this.root.alpha = this.alpha;
    }

    frame(alpha: number): void {
        if (!this.root) return;
        this.alpha = Math.max(0, Math.min(1, alpha));
        this.root.alpha = this.alpha;
        this.updatePositions();
    }

    clear(): void {
        this.nodes.clear();
        this.edges = [];
        this.offsets.clear();
        this.visiblePaths = [];
        this.visibleEdges = [];
        this.alpha = 0;
        if (this.root) {
            this.root.removeFromParent();
            this.root.destroy({ children: true });
            this.root = undefined;
        }
    }

    private ensureRoot(): void {
        if (this.root) return;
        this.root = new Container();
        this.root.name = "eg-branch-layer";
        this.root.eventMode = "passive";
        this.instances.renderer.hanger.addChild(this.root);
    }

    private buildNodes(previous: Map<string, Point>): void {
        if (!this.root) return;
        const missing = this.visiblePaths.filter(path => !this.corePosition(path) && path !== this.anchor && !previous.has(path));
        const radius = Math.max(90, 48 + missing.length * 11);
        let missingIndex = 0;
        for (const path of this.visiblePaths) {
            const core = !!this.corePosition(path);
            const group = new Container();
            group.name = `eg-branch-node:${path}`;
            const previewNode: PreviewNode = { path, group, core };
            if (core) {
                previewNode.ring = this.createRing();
                group.addChild(previewNode.ring);
            }
            else {
                this.offsets.set(path, this.nodeOffset(path, previous, missingIndex, missing.length, radius));
                if (missing.includes(path)) ++missingIndex;
                this.buildGhost(previewNode);
            }
            this.nodes.set(path, previewNode);
            this.root.addChild(group);
        }
    }

    private buildGhost(node: PreviewNode): void {
        const { group, path } = node;
        const shape = new Graphics();
        shape.beginFill(0x7c3aed, 0.92);
        shape.lineStyle({ width: 2, color: 0xffffff, alpha: 0.75 });
        shape.drawCircle(0, 0, 18);
        shape.endFill();
        shape.eventMode = "static";
        shape.cursor = "pointer";
        node.label = this.createLabel(path);
        group.addChild(shape);
        node.label.eventMode = "static";
        node.label.cursor = "pointer";
        group.addChild(node.label);
        this.bindNodeEvents(node.label, path);
        this.bindNodeEvents(shape, path);
    }

    private nodeOffset(path: string, previous: Map<string, Point>, index: number, total: number, radius: number): Point {
        if (path === this.anchor) return { x: 0, y: 0 };
        const point = previous.get(path);
        return point ? { x: point.x - this.anchorOrigin.x, y: point.y - this.anchorOrigin.y } : this.radialOffset(index, total, radius);
    }

    private buildEdges(): void {
        if (!this.root) return;
        for (const edge of this.visibleEdges) {
            if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target)) continue;
            const graphic = new Graphics();
            graphic.name = `eg-branch-edge:${edge.source}->${edge.target}`;
            graphic.eventMode = "static";
            graphic.cursor = "context-menu";
            this.bindEdgeEvents(graphic, edge);
            this.edges.push({ edge, graphic });
            this.root.addChildAt(graphic, 0);
        }
    }

    private updatePositions(): void {
        if (!this.root) return;
        const anchorPoint = this.corePosition(this.anchor) ?? this.anchorOrigin;
        for (const [path, node] of this.nodes) {
            const position = node.core ? this.corePosition(path) : this.add(anchorPoint, this.offsets.get(path));
            if (!position) continue;
            node.group.position.set(position.x, position.y);
            if (node.ring) this.drawRing(node.ring, this.coreRadius(path));
        }
        for (const item of this.edges) {
            const source = this.positionOf(item.edge.source);
            const target = this.positionOf(item.edge.target);
            if (!source || !target) continue;
            item.graphic.clear();
            item.graphic.lineStyle({ width: 2, color: 0x9b87f5, alpha: 0.68 });
            item.graphic.moveTo(source.x, source.y);
            item.graphic.lineTo(target.x, target.y);
            this.drawArrow(item.graphic, source, target);
        }
    }

    private positionOf(path: string): Point | undefined {
        const node = this.nodes.get(path);
        if (!node) return;
        return node.core ? this.corePosition(path) : this.add(this.corePosition(this.anchor) ?? this.anchorOrigin, this.offsets.get(path));
    }

    screenPosition(path: string): Point | undefined {
        const node = this.nodes.get(path);
        if (!node) return;
        const global = node.group.getGlobalPosition();
        const bounds = this.instances.renderer.interactiveEl.getBoundingClientRect();
        const screen = this.instances.renderer.px.renderer.screen;
        return { x: bounds.left + global.x * bounds.width / screen.width, y: bounds.top + global.y * bounds.height / screen.height };
    }

    hitNode(event: MouseEvent): { path: string; edge?: BranchEdge } | undefined {
        if (!this.root || this.alpha < 0.05) return;
        const { x, y } = this.pointerPosition(event);
        for (const [path, node] of this.nodes) {
            if (!node.core && node.group.getBounds().contains(x, y)) return { path, edge: this.relationEdge(path) };
        }
    }

    hitEdge(event: MouseEvent): BranchEdge | undefined {
        if (!this.root || this.alpha < 0.05) return;
        const point = this.pointerPosition(event);
        for (const { edge } of this.edges) {
            const source = this.nodes.get(edge.source)?.group.getGlobalPosition();
            const target = this.nodes.get(edge.target)?.group.getGlobalPosition();
            if (!source || !target) continue;
            const dx = target.x - source.x, dy = target.y - source.y;
            const length = dx * dx + dy * dy;
            if (!length) continue;
            const t = Math.max(0, Math.min(1, ((point.x - source.x) * dx + (point.y - source.y) * dy) / length));
            if (Math.hypot(point.x - source.x - t * dx, point.y - source.y - t * dy) <= 6) return edge;
        }
    }

    private pointerPosition(event: MouseEvent): Point {
        const bounds = this.instances.renderer.interactiveEl.getBoundingClientRect();
        const screen = this.instances.renderer.px.renderer.screen;
        return { x: (event.clientX - bounds.left) * screen.width / bounds.width, y: (event.clientY - bounds.top) * screen.height / bounds.height };
    }

    private drawArrow(graphic: Graphics, source: Point, target: Point): void {
        const angle = Math.atan2(target.y - source.y, target.x - source.x);
        const tip = { x: target.x - Math.cos(angle) * 21, y: target.y - Math.sin(angle) * 21 };
        graphic.moveTo(tip.x - Math.cos(angle - 0.5) * 9, tip.y - Math.sin(angle - 0.5) * 9);
        graphic.lineTo(tip.x, tip.y);
        graphic.lineTo(tip.x - Math.cos(angle + 0.5) * 9, tip.y - Math.sin(angle + 0.5) * 9);
    }

    private corePosition(path: string): Point | undefined {
        const node = this.instances.renderer.nodes.find(item => item.id === path);
        if (!node) return;
        return { x: node.x, y: node.y };
    }

    private coreRadius(path: string): number {
        const node = this.instances.renderer.nodes.find(item => item.id === path);
        if (!node) return 20;
        return Math.max(18, Math.min(100, node.getSize() + 8));
    }

    private createRing(): Graphics {
        const ring = new Graphics();
        ring.eventMode = "none";
        return ring;
    }

    private drawRing(ring: Graphics, radius: number): void {
        ring.clear();
        ring.lineStyle({ width: 3, color: 0xc4b5fd, alpha: 0.9 });
        ring.drawCircle(0, 0, radius);
    }

    private createLabel(path: string): Text {
        const label = new Text(this.displayName(path), { fontSize: 12, fill: 0xffffff });
        label.anchor.set(0.5, 0);
        label.position.set(0, 23);
        label.eventMode = "none";
        return label;
    }

    private bindNodeEvents(shape: Graphics | Text, path: string): void {
        shape.on("pointerover", event => {
            this.callbacks.hold("main");
            this.callbacks.enter(path, this.mouseEvent(event), "main");
        });
        shape.on("pointerout", () => this.callbacks.leave("main"));
        shape.on("pointertap", event => this.callbacks.open(path, this.mouseEvent(event)));
        shape.on("pointerup", event => {
            if (event.button !== 2) return;
            event.preventDefault();
            const edge = this.relationEdge(path);
            if (edge) this.callbacks.relations(edge.source, edge.target);
        });
    }

    private bindEdgeEvents(graphic: Graphics, edge: BranchEdge): void {
        graphic.on("pointerover", event => {
            this.callbacks.hold("main");
        });
        graphic.on("pointerout", () => this.callbacks.leave("main"));
        graphic.on("pointertap", event => this.callbacks.open(edge.target, this.mouseEvent(event)));
        graphic.on("pointerup", event => {
            if (event.button !== 2) return;
            event.preventDefault();
            this.callbacks.relations(edge.source, edge.target);
        });
    }

    private radialOffset(index: number, total: number, radius: number): Point {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, total);
        return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    }

    private relationEdge(path: string): BranchEdge | undefined {
        return this.visibleEdges.find(edge => edge.source === this.anchor && edge.target === path)
            ?? this.visibleEdges.find(edge => edge.target === this.anchor && edge.source === path)
            ?? this.visibleEdges.find(edge => edge.source === path || edge.target === path);
    }

    private add(left: Point, right?: Point): Point {
        return { x: left.x + (right?.x ?? 0), y: left.y + (right?.y ?? 0) };
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
        return Array.from(name).length > 14 ? Array.from(name).slice(0, 14).join("") + "…" : name;
    }

    private mouseEvent(event: unknown): MouseEvent {
        const nativeEvent = (event as { nativeEvent?: unknown }).nativeEvent;
        return (nativeEvent ?? event) as MouseEvent;
    }
}
