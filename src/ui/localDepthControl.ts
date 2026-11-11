import { Component } from "obsidian";
import { GraphInstances } from "../pluginInstances";

/** 当前局部图谱的核心深度快捷入口，不另存全局层数。 */
export class LocalDepthControl extends Component {
    private root: HTMLElement;
    private depth?: number;
    private ready?: boolean;

    constructor(private instances: GraphInstances) { super(); }

    override onload(): void {
        const tools = this.instances.view.contentEl.querySelector<HTMLElement>(".eg-local-tools")!;
        this.root = tools.createDiv({ cls: "eg-local-depth", attr: { role: "group", "aria-label": "局部图谱层数" } });
        for (const depth of [1, 2, 3]) {
            const button = this.root.createEl("button", {
                text: `${depth}层`, attr: { type: "button", "data-depth": String(depth),
                    "aria-label": `显示中心周围 ${depth} 层节点`, title: `显示中心周围 ${depth} 层；手动保留的分支不受影响` },
            });
            this.registerDomEvent(button, "click", () => this.select(depth));
            this.registerDomEvent(button, "keydown", event => this.onKey(event, depth));
        }
        this.registerDomEvent(this.root, "pointerdown", event => event.stopPropagation());
        this.sync();
    }

    sync(): boolean {
        const depth = this.instances.engine.options.localJumps ?? 1;
        const ready = this.instances.graphEventsDispatcher.lastFilteringAction?.record === true;
        if (!this.root || (depth === this.depth && ready === this.ready)) return false;
        const changed = this.depth !== undefined && depth !== this.depth;
        this.depth = depth;
        this.ready = ready;
        this.root.setAttribute("aria-label", `局部图谱层数：当前 ${depth} 层`);
        for (const button of Array.from(this.root.querySelectorAll<HTMLButtonElement>("button"))) {
            const selected = Number(button.dataset.depth) === depth;
            button.setAttribute("aria-pressed", String(selected));
            button.disabled = !ready;
            button.tabIndex = selected || (![1, 2, 3].includes(depth) && button.dataset.depth === "1") ? 0 : -1;
        }
        return changed;
    }

    private select(depth: number): void {
        if (!this.ready || depth === (this.instances.engine.options.localJumps ?? 1)) return;
        this.instances.engine.setOptions({ localJumps: depth });
        this.sync();
    }

    private onKey(event: KeyboardEvent, depth: number): void {
        const next = event.key === "Home" ? 1 : event.key === "End" ? 3
            : event.key === "ArrowRight" ? depth % 3 + 1 : event.key === "ArrowLeft" ? (depth + 1) % 3 + 1 : undefined;
        if (next === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        this.select(next);
        this.root.querySelector<HTMLButtonElement>(`[data-depth="${next}"]`)!.focus();
    }

    override onunload(): void { this.root?.remove(); }
}
