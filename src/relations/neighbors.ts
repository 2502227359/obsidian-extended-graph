import { App, Component, TFile, parseLinktext } from "obsidian";

export interface BranchEdge {
    source: string;
    target: string;
}

export interface NeighborBranch {
    anchor: string;
    nodes: string[];
    edges: BranchEdge[];
    total: number;
    hidden: number;
}

export interface NeighborOptions {
    incoming: boolean;
    outgoing: boolean;
    interlinks: boolean;
    includeSources: boolean;
    allowFile?: (path: string) => boolean;
    limit?: number;
    offset?: number;
}

const SOURCE_KEYS = new Set(["source", "source_archive"]);
const SOURCE_PAGE_TYPES = new Set(["exam_source", "exam_paper"]);

/** 维护文件级有向邻接索引，查询时只读取缓存中的索引和元数据。 */
export class NeighborIndex extends Component {
    private readonly files = new Map<string, TFile>();
    private readonly outgoing = new Map<string, Set<string>>();
    private readonly incoming = new Map<string, Set<string>>();
    private readonly sourceOnly = new Map<string, Set<string>>();
    private initialized = false;
    private bulkDirty = false;

    constructor(private readonly app: App) {
        super();
    }

    override onload(): void {
        this.registerEvent(this.app.metadataCache.on("resolve", file => {
            if (this.initialized) this.refreshSource(file.path);
        }));
        const invalidate = () => { this.initialized = false; this.bulkDirty = true; };
        this.registerEvent(this.app.metadataCache.on("resolved", () => {
            if (this.bulkDirty) { this.initialized = false; this.bulkDirty = false; }
        }));
        this.registerEvent(this.app.vault.on("create", invalidate));
        this.registerEvent(this.app.vault.on("rename", invalidate));
        this.registerEvent(this.app.vault.on("delete", invalidate));
    }

    getOneHop(anchor: string, options: NeighborOptions): NeighborBranch {
        if (!this.initialized) this.rebuild();
        if (!this.files.has(anchor)) return { anchor, nodes: [], edges: [], total: 0, hidden: 0 };
        const candidates = this.collectNeighbors(anchor, options);
        const sorted = [...candidates].sort((left, right) => left.localeCompare(right));
        const offset = Math.max(0, options.offset ?? 0);
        const limit = Math.max(0, options.limit ?? 20);
        const visible = sorted.slice(offset, offset + limit);
        const nodes = [anchor, ...visible];
        const edges = this.collectEdges(anchor, nodes, options);
        const hidden = options.includeSources ? 0 : this.collectNeighbors(anchor, { ...options, includeSources: true }).size - candidates.size;
        return { anchor, nodes, edges, total: sorted.length, hidden };
    }

    private rebuild() {
        this.files.clear();
        for (const file of this.app.vault.getMarkdownFiles()) this.files.set(file.path, file);
        this.outgoing.clear();
        this.incoming.clear();
        this.sourceOnly.clear();
        for (const path of this.files.keys()) this.refreshSource(path);
        this.initialized = true;
    }

    private refreshSource(path: string) {
        this.removeSource(path);
        const file = this.files.get(path) ?? this.findMarkdownFile(path);
        if (!file) return;
        this.files.set(path, file);
        const targets = new Set(Object.keys(this.app.metadataCache.resolvedLinks[path] ?? {})
            .filter(target => this.files.has(target)));
        this.outgoing.set(path, targets);
        this.sourceOnly.set(path, this.findSourceOnly(file, targets));
        for (const target of targets) {
            const sources = this.incoming.get(target) ?? new Set<string>();
            sources.add(path);
            this.incoming.set(target, sources);
        }
    }

    private findMarkdownFile(path: string): TFile | undefined {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile && file.extension === "md" ? file : undefined;
    }

    private removeSource(path: string) {
        const targets = this.outgoing.get(path);
        if (targets) {
            for (const target of targets) {
                const sources = this.incoming.get(target);
                sources?.delete(path);
                if (sources?.size === 0) this.incoming.delete(target);
            }
        }
        this.outgoing.delete(path);
        this.sourceOnly.delete(path);
    }

    private findSourceOnly(file: TFile, targets: Set<string>): Set<string> {
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatterTargets = new Set((cache?.frontmatterLinks ?? [])
            .filter(link => SOURCE_KEYS.has(link.key.split(".")[0]))
            .map(link => this.app.metadataCache.getFirstLinkpathDest(parseLinktext(link.link).path || file.path, file.path)?.path)
            .filter((path): path is string => !!path && targets.has(path)));
        const bodyLinks = [...(cache?.links ?? []), ...(cache?.embeds ?? []),
            ...(cache?.frontmatterLinks ?? []).filter(link => !SOURCE_KEYS.has(link.key.split(".")[0]))];
        const bodyTargets = new Set(bodyLinks
            .map(link => this.app.metadataCache.getFirstLinkpathDest(parseLinktext(link.link).path || file.path, file.path)?.path)
            .filter((path): path is string => !!path));
        return new Set([...frontmatterTargets].filter(path => !bodyTargets.has(path)));
    }

    private collectNeighbors(anchor: string, options: NeighborOptions): Set<string> {
        const neighbors = new Set<string>();
        if (options.outgoing) {
            for (const target of this.outgoing.get(anchor) ?? []) {
                if (this.isVisibleEdge(anchor, target, options)) neighbors.add(target);
            }
        }
        if (options.incoming) {
            for (const source of this.incoming.get(anchor) ?? []) {
                if (this.isVisibleEdge(source, anchor, options)) neighbors.add(source);
            }
        }
        return neighbors;
    }

    private collectEdges(anchor: string, nodes: string[], options: NeighborOptions): BranchEdge[] {
        const nodeSet = new Set(nodes);
        const edges = new Map<string, BranchEdge>();
        for (const source of nodes) {
            for (const target of this.outgoing.get(source) ?? []) {
                if (!nodeSet.has(target) || !this.isVisibleEdge(source, target, options)) continue;
                if (source === anchor && !options.outgoing) continue;
                if (target === anchor && !options.incoming) continue;
                const key = `${source}\u0000${target}`;
                edges.set(key, { source, target });
            }
        }
        if (!options.interlinks) {
            for (const [key, edge] of edges) {
                if (edge.source !== anchor && edge.target !== anchor) edges.delete(key);
            }
        }
        return [...edges.values()].sort((left, right) =>
            left.source.localeCompare(right.source) || left.target.localeCompare(right.target));
    }

    private isVisibleEdge(source: string, target: string, options: NeighborOptions): boolean {
        if (source === target) return false;
        if (!this.files.has(source) || !this.files.has(target)) return false;
        if (options.allowFile && (!options.allowFile(source) || !options.allowFile(target))) return false;
        if (options.includeSources) return true;
        if (this.sourceOnly.get(source)?.has(target)) return false;
        return !this.isSourcePage(source) && !this.isSourcePage(target);
    }

    private isSourcePage(path: string): boolean {
        const frontmatter = this.app.metadataCache.getFileCache(this.files.get(path)!)?.frontmatter;
        if (!frontmatter) return false;
        const pageType = frontmatter.page_type ?? frontmatter.type;
        if (Array.isArray(pageType)) return pageType.some(value => SOURCE_PAGE_TYPES.has(String(value)));
        return SOURCE_PAGE_TYPES.has(String(pageType));
    }
}
