import { App, CachedMetadata, Pos, Reference, ReferenceCache, TFile, parseLinktext, resolveSubpath } from "obsidian";

export interface RelationOccurrence {
    position?: Pos;
    heading: string;
    excerpt: string;
    original: string;
    property?: string;
    alias?: string;
}

export interface RelationGroup {
    direction: "outgoing" | "incoming";
    sourcePath: string;
    targetPath: string;
    subpath: string;
    label: string;
    status: "valid" | "file" | "missing" | "ambiguous";
    occurrences: RelationOccurrence[];
}

function describeTarget(cache: CachedMetadata | null, subpath: string): Pick<RelationGroup, "label" | "status"> {
    if (!subpath) return { label: "整篇引用", status: "file" };
    const resolved = cache && resolveSubpath(cache, subpath);
    if (!resolved) return { label: subpath.slice(1), status: "missing" };
    if (resolved.type === "heading") {
        const heading = resolved.current.heading;
        const duplicates = cache?.headings?.filter(item => item.heading === heading).length ?? 0;
        const ambiguous = !subpath.slice(1).includes("#") && duplicates > 1;
        return { label: heading, status: ambiguous ? "ambiguous" : "valid" };
    }
    return { label: subpath.startsWith("#^") ? `块：${subpath.slice(2)}` : subpath.slice(1), status: "valid" };
}

function describeSource(reference: Reference, cache: CachedMetadata, lines: string[]): RelationOccurrence {
    const position = "position" in reference ? (reference as ReferenceCache).position : undefined;
    const property = "key" in reference ? String(reference.key) : undefined;
    const heading = position ? cache.headings?.filter(item => item.position.start.offset < position.start.offset).pop()?.heading : undefined;
    const line = position ? lines[position.start.line]?.trim() : undefined;
    return {
        position,
        heading: heading ?? (property ? `属性：${property}` : "正文开头"),
        excerpt: line ?? reference.original,
        original: reference.original,
        property,
        alias: reference.original.includes("|") || /^!?\[[^\]]*\]\(/.test(reference.original) ? reference.displayText?.trim() : undefined,
    };
}

async function collectDirection(app: App, source: TFile, target: TFile, direction: RelationGroup["direction"]): Promise<RelationGroup[]> {
    const text = await app.vault.cachedRead(source);
    const cache = app.metadataCache.getFileCache(source);
    if (!cache) return [];
    const lines = text.split("\n");
    const groups = new Map<string, RelationGroup>();
    const references: Reference[] = [...(cache.links ?? []), ...(cache.embeds ?? []), ...(cache.frontmatterLinks ?? [])];
    for (const reference of references) {
        const link = parseLinktext(reference.link);
        const destination = link.path ? app.metadataCache.getFirstLinkpathDest(link.path, source.path) : source;
        if (destination?.path !== target.path) continue;
        if ("position" in reference) {
            const position = (reference as ReferenceCache).position;
            if (text.slice(position.start.offset, position.end.offset) !== reference.original) {
                throw new Error("引用位置正在更新，请稍后重试。");
            }
        }
        let group = groups.get(link.subpath);
        if (!group) {
            group = {
                direction, sourcePath: source.path, targetPath: target.path, subpath: link.subpath,
                ...describeTarget(app.metadataCache.getFileCache(target), link.subpath), occurrences: [],
            };
            groups.set(link.subpath, group);
        }
        group.occurrences.push(describeSource(reference, cache, lines));
    }
    return [...groups.values()];
}

/** 只读取指定文件对，保留文件级图谱中丢失的锚点和引用证据。 */
export async function readRelations(app: App, centerPath: string, neighborPath: string): Promise<RelationGroup[]> {
    const center = app.vault.getAbstractFileByPath(centerPath);
    const neighbor = app.vault.getAbstractFileByPath(neighborPath);
    if (!(center instanceof TFile) || !(neighbor instanceof TFile) || center === neighbor) return [];
    const [outgoing, incoming] = await Promise.all([
        collectDirection(app, center, neighbor, "outgoing"),
        collectDirection(app, neighbor, center, "incoming"),
    ]);
    return [...outgoing, ...incoming];
}
