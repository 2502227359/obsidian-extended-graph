import { pathParse } from "../helpers/path";

interface NodePath {
    path: string;
    originalName: string;
    name: string;
    folders: string[];
}

function splitPath(path: string): NodePath {
    const normalized = path.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    const file = pathParse(path).basename || path;
    parts.pop();
    return { path: normalized, originalName: file, name: semanticName(file), folders: parts };
}

function semanticName(name: string): string {
    const chapter = /^\s*(?:\d+(?:[.．]\d+)+(?:\s*[-—:：、.)]\s*|\s+|(?=[^\d.]))|\d{1,3}\s*[、.)]\s*)/;
    const result = name.replace(chapter, "").trim();
    return result || name;
}

function fit(text: string, maxLength: number): string {
    const units = Array.from(text);
    if (units.length <= maxLength) return text;
    if (maxLength <= 1) return units.slice(0, maxLength).join("");
    return units.slice(0, maxLength - 1).join("") + "…";
}

function folderSuffix(current: NodePath, peers: NodePath[]): string {
    for (let depth = 1; depth <= current.folders.length; ++depth) {
        const suffix = current.folders.slice(-depth).join("/");
        if (peers.every(peer => peer.folders.slice(-depth).join("/") !== suffix)) return suffix;
    }
    return current.folders.join("/") || "?";
}

function compactPair(name: string, suffix: string, maxLength: number): string {
    const delimiter = "·";
    if (maxLength <= 1) return fit(name, maxLength);
    if (maxLength === 2) return fit(name, 1) + fit(suffix, 1);
    const suffixUnits = Array.from(suffix);
    const suffixBudget = Math.max(1, maxLength - 7);
    const compactSuffix = fit(suffix, Math.min(suffixUnits.length, suffixBudget));
    const nameBudget = Math.max(1, maxLength - Array.from(compactSuffix).length - delimiter.length);
    return fit(name, nameBudget) + delimiter + compactSuffix;
}

function sameNamePeers(current: NodePath, visiblePaths: string[]): NodePath[] {
    const paths = [...new Set(visiblePaths.map(path => path.replace(/\\/g, "/")))];
    return paths.map(splitPath)
        .filter(candidate => candidate.path !== current.path && candidate.name === current.name);
}

function displayName(current: NodePath, group: NodePath[]): string {
    return group.some(item => item.originalName !== current.originalName) ? current.originalName : current.name;
}

function hasDistinctCandidate(current: NodePath, peers: NodePath[], group: NodePath[], maxLength: number): boolean {
    const nodes = [current, ...peers];
    const labels = nodes.map(node => {
        const otherPeers = nodes.filter(item => item.path !== node.path);
        return compactPair(displayName(node, group), folderSuffix(node, otherPeers), maxLength);
    });
    return new Set(labels).size === labels.length;
}

function ordinalLabel(current: NodePath, peers: NodePath[], fullGroup: NodePath[], maxLength: number): string {
    const group = [current, ...peers].sort((left, right) => left.path.localeCompare(right.path));
    const index = group.findIndex(item => item.path === current.path) + 1;
    return compactPair(displayName(current, fullGroup), `~${index.toString(36)}`, maxLength);
}

/** 为局部图节点生成紧凑、可辨认且在当前可见集合内尽量唯一的名称。 */
export function nodeLabel(path: string, visiblePaths: string[], maxLength: number): string {
    const limit = Math.max(1, Math.floor(maxLength));
    const current = splitPath(path);
    const peers = sameNamePeers(current, visiblePaths);
    if (!peers.length) return fit(current.name, limit);
    const group = [current, ...peers];
    const sameOriginalPeers = peers.filter(peer => peer.originalName === current.originalName);
    if (!sameOriginalPeers.length) return fit(current.originalName, limit);
    if (hasDistinctCandidate(current, sameOriginalPeers, group, limit)) {
        return compactPair(displayName(current, group), folderSuffix(current, sameOriginalPeers), limit);
    }
    return ordinalLabel(current, sameOriginalPeers, group, limit);
}
