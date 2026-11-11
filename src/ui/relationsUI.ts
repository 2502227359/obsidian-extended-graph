import { Component, ExtraButtonComponent, HoverParent, Notice, Platform, TFile } from "obsidian";
import { LocalGraphView } from "obsidian-typings";
import { ExtendedGraphInstances, GraphInstances } from "../pluginInstances";
import { readRelations, RelationGroup, RelationOccurrence } from "../relations/relations";
import { holdCenter } from "../graph/centerPin";

export const RELATIONS_HOVER_SOURCE = "extended-graph-relations";

interface LinkLocation {
    linktext: string;
    sourcePath: string;
    state?: Record<string, unknown>;
}

export class RelationsUI extends Component {
    private root: HTMLDivElement;
    private body: HTMLDivElement;
    private count: HTMLDivElement;
    private status: HTMLDivElement;
    private context: HTMLDivElement;
    private groups: RelationGroup[] = [];
    private revision = 0;
    private interaction = { preview: 0, direct: 0, navigate: 0 };
    private active = false;
    private hoverParents = new Set<HoverParent>();
    private centerPath: string;
    private pinnedByPanel = false;
    private releaseCenter?: () => void;
    private graphCenterPath: string;
    private directPreviewMode: boolean;
    private pendingAltRelease: boolean;
    private previewTarget?: HTMLElement;
    private cancelFeedback?: () => void;

    constructor(private instances: GraphInstances, private neighborPath: string, anchorPath?: string, private initialPreviewEvent?: MouseEvent) {
        super();
        this.graphCenterPath = (instances.view as LocalGraphView).file?.path ?? "";
        this.centerPath = anchorPath ?? this.graphCenterPath;
        this.directPreviewMode = !!initialPreviewEvent;
        this.pendingAltRelease = !!initialPreviewEvent?.altKey;
    }

    override onload(): void {
        this.active = true;
        const leaf = this.instances.view.leaf;
        this.pinnedByPanel = !leaf.pinned;
        this.releaseCenter = holdCenter(leaf);
        this.createPanel();
        this.registerDomEvent(this.instances.view.containerEl.win, "keyup", event => {
            if (!this.pendingAltRelease || event.key !== "Alt") return;
            this.pendingAltRelease = false;
            // 消费本次点击手势的松键，避免浮窗把 Alt 释放误判为取消悬浮。
            event.stopPropagation();
        }, true);
        this.registerDomEvent(this.root, "mouseover", event => { void this.followLink(event, true); });
        this.registerDomEvent(this.root, "mouseout", event => {
            const anchor = (event.target as Element | null)?.closest("a[data-group]");
            const related = event.relatedTarget as Node | null;
            if (anchor && !(related?.nodeType && anchor.contains(related))) ++this.interaction.preview;
        });
        this.registerDomEvent(this.root, "click", event => { void this.followLink(event, false); });
        const app = ExtendedGraphInstances.app;
        this.registerEvent(app.metadataCache.on("changed", file => {
            if ([this.centerPath, this.neighborPath].includes(file.path)) void this.refresh();
        }));
        this.registerEvent(app.vault.on("rename", (file, oldPath) => {
            if (![this.centerPath, this.neighborPath].includes(oldPath)) return;
            if (oldPath === this.centerPath) this.centerPath = file.path;
            if (oldPath === this.graphCenterPath) this.graphCenterPath = file.path;
            if (oldPath === this.neighborPath) this.neighborPath = file.path;
            void this.refresh();
        }));
        this.registerEvent(app.vault.on("delete", file => {
            if ([this.centerPath, this.neighborPath].includes(file.path)) void this.refresh();
        }));
        void this.refresh();
    }

    private createPanel(): void {
        this.root = this.instances.view.contentEl.createDiv({ cls: "eg-relations-panel" });
        this.root.setAttribute("role", "region");
        this.root.setAttribute("aria-label", "与中心笔记的关联位置");
        const header = this.root.createDiv({ cls: "eg-relations-header" });
        header.createEl("strong", { text: "关联位置" });
        new ExtraButtonComponent(header).setIcon("x").setTooltip("关闭关联面板")
            .onClick(() => this.instances.graphEventsDispatcher.removeChild(this))
            .extraSettingsEl.addClass("eg-relations-close");
        this.context = this.root.createDiv({ cls: "eg-relations-context" });
        this.count = this.root.createDiv({ cls: "eg-relations-count" });
        this.status = this.root.createDiv({ cls: "eg-relations-status", attr: { role: "status", "aria-live": "polite" } });
        this.root.setAttribute("aria-busy", "false");
        this.body = this.root.createDiv({ cls: "eg-relations-body" });
    }

    private async refresh(): Promise<void> {
        const revision = ++this.revision;
        const stopFeedback = this.trackLocation(this.root, () => this.active && revision === this.revision, "正在刷新关联…");
        try {
            const groups = await readRelations(ExtendedGraphInstances.app, this.centerPath, this.neighborPath);
            if (!this.active || revision !== this.revision) return;
            this.cancelFeedback?.();
            this.clearPreviews();
            this.groups = groups;
            this.render();
            const event = this.initialPreviewEvent;
            const first = this.body.querySelector<HTMLAnchorElement>(".eg-relations-target");
            if (event && first && await this.followAnchor(event, first, true)) this.initialPreviewEvent = undefined;
        } catch (error) {
            if (!this.active || revision !== this.revision) return;
            this.cancelFeedback?.();
            this.clearPreviews();
            this.groups = [];
            this.count.setText("关联暂不可用");
            this.status.empty();
            this.root.setAttribute("aria-busy", "false");
            this.body.setText("关联读取失败，请关闭后重试。");
            console.error("读取局部图谱关联失败", error);
        } finally {
            stopFeedback();
        }
    }

    private render(): void {
        const open = new Set(Array.from(this.body.querySelectorAll<HTMLDetailsElement>("details[open]")).map(item => item.dataset.key));
        const selected = this.body.querySelector<HTMLElement>("[aria-current]")?.dataset.key;
        const scroll = this.body.scrollTop;
        this.root.dataset.center = this.centerPath;
        this.root.dataset.neighbor = this.neighborPath;
        this.body.empty();
        this.context.empty();
        this.count.setText(`${this.groups.length} 个关联位置 · ${this.groups.reduce((sum, group) => sum + group.occurrences.length, 0)} 次引用`);
        const pair = this.context.createDiv({ cls: "eg-relations-pair", text: `${this.fileName(this.centerPath)} ↔ ${this.fileName(this.neighborPath)}` });
        pair.title = `${this.centerPath} ↔ ${this.neighborPath}`;
        if (this.directPreviewMode) this.context.createDiv({ cls: "eg-relations-hint", text: `点击切换浮窗 · ${Platform.isMacOS ? "⌘" : "Ctrl"}＋点击打开标签页` });
        if (this.pinnedByPanel) this.context.createDiv({ cls: "eg-relations-hint", text: "中心已固定 · 关闭后恢复" });
        if (!this.groups.length) this.body.createEl("p", { text: "这两个文件当前没有可解析的直接引用。" });
        this.groups.forEach((group, index) => this.renderGroup(group, index));
        this.body.querySelectorAll<HTMLDetailsElement>("details").forEach(item => { item.open = open.has(item.dataset.key); });
        const anchor = Array.from(this.body.querySelectorAll<HTMLAnchorElement>("a[data-key]")).find(item => item.dataset.key === selected);
        if (anchor) this.selectLocation(anchor);
        else this.status.empty();
        this.body.scrollTop = scroll;
    }

    private renderGroup(group: RelationGroup, index: number): void {
        const card = this.body.createDiv({ cls: "eg-relations-group" });
        const key = JSON.stringify([group.direction, group.sourcePath, group.targetPath, group.subpath]);
        card.dataset.key = key;
        card.createDiv({ cls: "eg-relations-direction", text: `${group.direction === "outgoing" ? "中心 → 关联笔记" : "关联笔记 → 中心"} · ${group.occurrences.length} 次引用` });
        const aliases = [...new Set(group.occurrences.map(item => item.alias).filter((alias): alias is string => !!alias && alias !== group.label))];
        const target = card.createEl("a", { cls: "eg-relations-target", text: aliases[0] ?? group.label, href: "#" });
        if (aliases.length) card.createDiv({ cls: "eg-relations-location", text: group.label });
        if (aliases.length > 1) {
            const names = card.createEl("details", { cls: "eg-relations-aliases" });
            names.dataset.key = key + ":aliases";
            names.createEl("summary", { text: `其他名称 · ${aliases.length - 1}` });
            names.createDiv({ text: aliases.slice(1).join("、") });
        }
        target.dataset.group = String(index);
        target.dataset.kind = "target";
        target.dataset.key = key + ":target";
        target.dataset.subpath = group.subpath;
        target.title = `${group.targetPath}${group.subpath}`;
        if (this.directPreviewMode && group.status !== "valid") target.title = "目标未指定有效段落，预览第一处引用原文";
        if (["missing", "ambiguous"].includes(group.status)) {
            target.setAttribute("aria-disabled", "true");
            card.createDiv({ cls: "eg-relations-warning", text: group.status === "missing" ? "定位已失效，可展开查看引用原文。" : "目标存在同名标题，需核对原链接。" });
        }
        const details = card.createEl("details");
        details.dataset.key = key + ":sources";
        details.createEl("summary", { text: `引用原文：${[...new Set(group.occurrences.map(item => item.heading))].join("、")}` });
        group.occurrences.forEach((occurrence, occurrenceIndex) => this.renderOccurrence(details, occurrence, index, occurrenceIndex));
    }

    private renderOccurrence(parent: HTMLElement, occurrence: RelationOccurrence, group: number, index: number): void {
        const item = parent.createDiv({ cls: "eg-relations-occurrence" });
        item.createEl("p", { text: occurrence.excerpt });
        const source = item.createEl("a", { cls: "eg-relations-source", text: occurrence.position ? `打开引用原文 · 第 ${occurrence.position.start.line + 1} 行` : "打开来源属性", href: "#" });
        source.dataset.group = String(group);
        source.dataset.occurrence = String(index);
        source.dataset.kind = "source";
        const signature = this.occurrenceKey(occurrence);
        if (this.groups[group].occurrences.filter(item => this.occurrenceKey(item) === signature).length === 1) {
            source.dataset.key = parent.closest<HTMLElement>(".eg-relations-group")!.dataset.key + ":source:" + signature;
        }
    }

    private occurrenceKey(occurrence: RelationOccurrence): string {
        return JSON.stringify([occurrence.original, occurrence.heading, occurrence.property, occurrence.excerpt]);
    }

    private async followLink(event: MouseEvent, preview: boolean): Promise<void> {
        if (preview && this.directPreviewMode) return;
        const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[data-group]");
        if (!anchor || !this.root.contains(anchor)) return;
        const related = event.relatedTarget as Node | null;
        if (preview && related?.nodeType && anchor.contains(related)) return;
        if (!preview) {
            event.preventDefault();
            this.initialPreviewEvent = undefined;
            ++this.interaction.preview;
            ++this.interaction.direct;
            if (this.directPreviewMode && !event.ctrlKey && !event.metaKey) preview = true;
        }
        await this.followAnchor(event, anchor, preview);
    }

    private async followAnchor(event: MouseEvent, anchor: HTMLAnchorElement, preview: boolean): Promise<boolean> {
        if (preview && this.directPreviewMode) anchor = this.directPreviewAnchor(anchor);
        const revision = this.revision;
        const kind = preview ? (this.directPreviewMode ? "direct" : "preview") : "navigate";
        const interaction = ++this.interaction[kind];
        const stopFeedback = this.trackLocation(anchor, () => this.isCurrent(revision, kind, interaction) && anchor.isConnected);
        try {
            const location = await this.resolveLocation(anchor);
            if (!this.isCurrent(revision, kind, interaction) || !anchor.isConnected) return false;
            if (!location) {
                this.status.setText("无法准确定位，请展开引用原文核对。");
                if (!preview) new Notice("无法准确定位，请重新查看关联或展开引用原文。");
                return false;
            }
            this.selectLocation(anchor);
            if (preview) this.preview(event, anchor, location);
            else await ExtendedGraphInstances.app.workspace.openLinkText(location.linktext, location.sourcePath, "tab", { eState: location.state });
            return true;
        } catch (error) {
            if (this.isCurrent(revision, kind, interaction)) this.status.setText("定位失败，请重试或查看引用原文。");
            if (!preview) new Notice("无法打开关联位置，请重试。");
            console.error("打开局部图谱关联失败", error);
            return false;
        } finally {
            stopFeedback();
        }
    }

    private trackLocation(anchor: HTMLElement, current: () => boolean, message = "正在定位…"): () => void {
        this.cancelFeedback?.();
        const timer = window.setTimeout(() => {
            if (!current()) return;
            this.root.setAttribute("aria-busy", "true");
            anchor.closest(".eg-relations-group")?.addClass("is-loading");
            this.status.setText(message);
        }, 120);
        const stop = () => {
            window.clearTimeout(timer);
            if (this.cancelFeedback !== stop) return;
            this.cancelFeedback = undefined;
            this.root.setAttribute("aria-busy", "false");
            this.body.querySelectorAll(".is-loading").forEach(card => card.removeClass("is-loading"));
            if (["正在定位…", "正在刷新关联…"].includes(this.status.textContent ?? "")) this.status.empty();
        };
        this.cancelFeedback = stop;
        return stop;
    }

    private isCurrent(revision: number, kind: keyof RelationsUI["interaction"], interaction: number): boolean {
        return this.active && revision === this.revision && interaction === this.interaction[kind];
    }

    private selectLocation(anchor: HTMLElement): void {
        this.body.querySelectorAll("[aria-current]").forEach(item => item.removeAttribute("aria-current"));
        anchor.setAttribute("aria-current", "location");
        const active = anchor.closest(".eg-relations-group");
        this.body.querySelectorAll(".eg-relations-group").forEach(card => card.classList.toggle("is-previewing", card === active));
        const label = anchor.dataset.kind === "source" ? anchor.textContent?.replace(/^打开/, "") : `目标位置 · ${anchor.textContent}`;
        this.status.setText(`当前选择：${label}`);
        this.status.title = this.status.textContent ?? "";
    }

    private directPreviewAnchor(anchor: HTMLAnchorElement): HTMLAnchorElement {
        const index = Number(anchor.dataset.group), group = this.groups[index];
        if (anchor.dataset.kind === "target" && group?.status !== "valid") {
            return this.body.querySelector<HTMLAnchorElement>(`.eg-relations-source[data-group="${index}"]`) ?? anchor;
        }
        return anchor;
    }

    private async resolveLocation(anchor: HTMLAnchorElement): Promise<LinkLocation | null> {
        const original = this.groups[Number(anchor.dataset.group)];
        if (!original) return null;
        const current = await readRelations(ExtendedGraphInstances.app, this.centerPath, this.neighborPath);
        const group = current.find(item => item.direction === original.direction && item.targetPath === original.targetPath && item.subpath === original.subpath);
        if (!group) return null;
        if (anchor.dataset.kind === "target") {
            return ["missing", "ambiguous"].includes(group.status) ? null : {
                linktext: group.targetPath + group.subpath, sourcePath: group.sourcePath,
            };
        }
        const occurrence = group.occurrences[Number(anchor.dataset.occurrence)];
        if (!occurrence) return null;
        return {
            linktext: group.sourcePath, sourcePath: group.sourcePath,
            state: occurrence.position ? { line: occurrence.position.start.line, startLoc: occurrence.position.start, endLoc: occurrence.position.end } : undefined,
        };
    }

    private preview(event: MouseEvent, anchor: HTMLElement, location: LinkLocation): void {
        this.clearPreviews();
        if (this.directPreviewMode) {
            // 点击预览使用独立触发元素，避免悬浮插件短暂屏蔽刚关闭的同一目标。
            this.previewTarget = anchor.createSpan({ attr: { "aria-hidden": "true" } });
        }
        const parent: HoverParent = { hoverPopover: null };
        this.hoverParents.add(parent);
        const previewEvent = this.directPreviewMode
            ? new MouseEvent("mouseover", { clientX: event.clientX, clientY: event.clientY, view: event.view }) : event;
        ExtendedGraphInstances.app.workspace.trigger("hover-link", {
            event: previewEvent, source: RELATIONS_HOVER_SOURCE, hoverParent: parent,
            targetEl: this.previewTarget ?? anchor, linktext: location.linktext, sourcePath: location.sourcePath, state: location.state,
        });
    }

    private clearPreviews(): void {
        for (const parent of this.hoverParents) {
            const popover = parent.hoverPopover as (HoverParent["hoverPopover"] & { hide(): void; isPinned?: boolean });
            if (popover && !popover.isPinned) popover.hide();
        }
        this.hoverParents.clear();
        this.previewTarget?.remove();
        this.previewTarget = undefined;
    }

    private fileName(path: string): string {
        const file = ExtendedGraphInstances.app.vault.getAbstractFileByPath(path);
        const other = ExtendedGraphInstances.app.vault.getAbstractFileByPath(path === this.centerPath ? this.neighborPath : this.centerPath);
        if (file instanceof TFile && other instanceof TFile && file.basename === other.basename) return file.path;
        return file instanceof TFile ? file.basename : path;
    }

    closeIfCenterChanged(): void {
        const current = (this.instances.view as LocalGraphView).file?.path;
        if (this.active && current && current !== this.graphCenterPath) {
            this.instances.graphEventsDispatcher.removeChild(this);
        }
    }

    override onunload(): void {
        this.active = false;
        this.initialPreviewEvent = undefined;
        this.pendingAltRelease = false;
        this.cancelFeedback?.();
        ++this.revision;
        this.clearPreviews();
        this.root?.remove();
        this.releaseCenter?.();
    }
}
