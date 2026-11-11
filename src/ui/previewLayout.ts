import { Component } from "obsidian";
import type { GraphInstances } from "../pluginInstances";
import type { PreviewCallbacks } from "../graph/previewLayer";

interface Point { x: number; y: number; }
interface WindowDrag { id: number; start: Point; origin: Point; }

/** 为宽窗预览保留真实画布空间，并管理窄窗浮窗位置。 */
export class PreviewLayout extends Component {
    docked = false;
    dragging = false;
    private enabled = false;
    private root?: HTMLElement;
    private viewport?: HTMLDivElement;
    private rail?: HTMLDivElement;
    private position?: Point;
    private drag?: WindowDrag;
    private readonly originalContainer: HTMLDivElement;

    constructor(private instances: GraphInstances, private callbacks: PreviewCallbacks) {
        super();
        this.originalContainer = instances.renderer.containerEl;
    }

    override onload(): void {
        const observer = new ResizeObserver(() => this.sync());
        observer.observe(this.instances.view.contentEl);
        this.register(() => observer.disconnect());
        const win = this.instances.view.containerEl.win;
        this.registerDomEvent(win, "pointermove", event => this.move(event));
        this.registerDomEvent(win, "pointerup", event => this.endDrag(event.pointerId));
        this.registerDomEvent(win, "pointercancel", event => this.endDrag(event.pointerId));
        this.registerDomEvent(win, "blur", () => this.endDrag());
    }

    attach(root: HTMLElement): void {
        this.root = root;
        this.updateMode();
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        this.sync();
        if (!enabled) this.endDrag();
    }

    sync(): void {
        const next = this.enabled && this.instances.view.contentEl.clientWidth >= 880;
        if (next === this.docked) {
            if (!this.enabled) return;
            const renderer = this.instances.renderer;
            if (renderer.px?.renderer && (renderer.width !== renderer.containerEl.clientWidth
                || renderer.height !== renderer.containerEl.clientHeight)) renderer.onResize();
            return;
        }
        this.docked = next;
        if (next) this.reserve(); else this.restore();
        this.endDrag();
        this.updateMode();
        if (this.instances.renderer.px?.renderer) this.instances.renderer.onResize();
    }

    private updateMode(): void {
        this.root?.classList.toggle("is-docked", this.docked);
        this.root?.classList.toggle("is-floating", !this.docked);
    }

    private reserve(): void {
        const area = this.instances.view.contentEl;
        area.classList.add("eg-preview-reserved");
        this.viewport = area.createDiv({ cls: "eg-preview-viewport", attr: { "aria-hidden": "true" } });
        this.rail = area.createDiv({ cls: "eg-preview-rail", attr: { "aria-hidden": "true" } });
        this.rail.createDiv({ cls: "eg-preview-idle", text: "悬浮节点以查看关联" });
        // canvas 与 iframe 留在原位，避免移动 iframe 导致 WebGL 上下文重载。
        this.instances.renderer.containerEl = this.viewport;
    }

    private restore(): void {
        this.instances.view.contentEl.classList.remove("eg-preview-reserved");
        if (this.instances.renderer.containerEl === this.viewport) this.instances.renderer.containerEl = this.originalContainer;
        this.viewport?.remove();
        this.rail?.remove();
        this.viewport = this.rail = undefined;
    }

    startDrag(event: PointerEvent): void {
        if (this.docked || event.button !== 0 || (event.target as Element).closest("button, a")) return;
        const bounds = this.instances.view.contentEl.getBoundingClientRect(), panel = this.root!.getBoundingClientRect();
        event.preventDefault();
        this.drag = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: panel.left - bounds.left, y: panel.top - bounds.top } };
        this.dragging = true;
        this.root!.classList.add("is-dragging");
        this.callbacks.hold("mini");
    }

    private move(event: PointerEvent): void {
        if (!this.drag || event.pointerId !== this.drag.id) return;
        const { origin, start } = this.drag;
        this.place({ x: origin.x + event.clientX - start.x, y: origin.y + event.clientY - start.y });
    }

    private endDrag(id?: number): void {
        if (!this.drag || (id !== undefined && id !== this.drag.id)) return;
        this.drag = undefined;
        this.dragging = false;
        this.root?.classList.remove("is-dragging");
        if (!this.root?.matches(":hover") && !this.root?.contains(this.root.ownerDocument.activeElement)) this.callbacks.leave("mini");
    }

    restorePosition(): boolean {
        return !this.docked && !!this.position && this.place(this.position);
    }

    private place(point: Point): boolean {
        if (!this.root) return false;
        const bounds = this.instances.view.contentEl.getBoundingClientRect();
        const x = Math.max(12, Math.min(point.x, bounds.width - this.root.offsetWidth - 12));
        const y = Math.max(52, Math.min(point.y, bounds.height - this.root.offsetHeight - 12));
        const blocker = this.instances.view.contentEl.querySelector<HTMLElement>(".eg-relations-panel")?.getBoundingClientRect();
        if (blocker && bounds.left + x < blocker.right && bounds.left + x + this.root.offsetWidth > blocker.left
            && bounds.top + y < blocker.bottom && bounds.top + y + this.root.offsetHeight > blocker.top) return false;
        this.root.style.left = `${x}px`;
        this.root.style.top = `${y}px`;
        this.position = { x, y };
        return true;
    }

    override onunload(): void {
        this.setEnabled(false);
        this.restore();
    }
}
