import { Component } from "obsidian";
import type { GraphInstances } from "../pluginInstances";
import type { PreviewCallbacks } from "../graph/previewLayer";

interface Point { x: number; y: number; }
interface WindowDrag { id: number; start: Point; origin: Point; }

/** 管理关联预览浮窗的拖动和当前视图位置。 */
export class PreviewLayout extends Component {
    dragging = false;
    private root?: HTMLElement;
    private position?: Point;
    private drag?: WindowDrag;

    constructor(private instances: GraphInstances, private callbacks: PreviewCallbacks) {
        super();
    }

    override onload(): void {
        const win = this.instances.view.containerEl.win;
        this.registerDomEvent(win, "pointermove", event => this.move(event));
        this.registerDomEvent(win, "pointerup", event => this.endDrag(event.pointerId));
        this.registerDomEvent(win, "pointercancel", event => this.endDrag(event.pointerId));
        this.registerDomEvent(win, "blur", () => this.endDrag());
    }

    attach(root: HTMLElement): void {
        this.root = root;
        this.root.classList.add("is-floating");
    }

    startDrag(event: PointerEvent): void {
        if (event.button !== 0 || (event.target as Element).closest("button, a")) return;
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
        this.cancelDrag();
        if (!this.root?.matches(":hover") && !this.root?.contains(this.root.ownerDocument.activeElement)) this.callbacks.leave("mini");
    }

    restorePosition(): boolean {
        return !!this.position && this.place(this.position);
    }

    cancelDrag(): void {
        this.drag = undefined;
        this.dragging = false;
        this.root?.classList.remove("is-dragging");
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
        this.cancelDrag();
    }
}
