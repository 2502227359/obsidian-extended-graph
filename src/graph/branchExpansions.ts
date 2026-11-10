import { GraphData, GraphNodeData } from "obsidian-typings";
import { BranchEdge, NeighborBranch } from "../relations/neighbors";

/** 管理用户手动展开的分支，并把分支合并到一次性的图数据副本。 */
export class BranchExpansions {
    readonly anchors = new Set<string>();
    private readonly supports = new Map<string, BranchEdge[]>();

    toggle(anchor: string): void {
        if (this.anchors.has(anchor)) { this.anchors.delete(anchor); this.supports.delete(anchor); }
        else this.anchors.add(anchor);
    }

    clear(): void {
        this.anchors.clear();
        this.supports.clear();
    }

    keep(anchor: string, edges: BranchEdge[]): void {
        this.anchors.add(anchor);
        this.supports.set(anchor, edges.map(edge => ({ ...edge })));
    }

    compose(base: GraphData, query: (path: string) => NeighborBranch): GraphData {
        const result = this.clone(base);
        for (const anchor of this.anchors) {
            const branch = query(anchor);
            if (!branch.nodes.length) continue;
            this.mergeBranch(result, branch);
            for (const edge of this.supports.get(anchor) ?? []) {
                if (query(edge.source).edges.some(current => current.source === edge.source && current.target === edge.target)) {
                    this.mergeBranch(result, { ...branch, nodes: [edge.source, edge.target], edges: [edge] });
                }
            }
        }
        result.numLinks = Object.values(result.nodes)
            .reduce((total, node) => total + Object.keys(node.links).length, 0);
        return result;
    }

    private clone(data: GraphData): GraphData {
        const nodes: Record<string, GraphNodeData> = {};
        for (const [path, node] of Object.entries(data.nodes)) {
            nodes[path] = {
                ...node,
                links: { ...node.links },
                ...(node.color ? { color: { ...node.color } } : {}),
            };
        }
        return { nodes, numLinks: data.numLinks };
    }

    private mergeBranch(data: GraphData, branch: NeighborBranch): void {
        for (const path of branch.nodes) this.ensureNode(data, path);
        for (const edge of branch.edges) {
            this.ensureNode(data, edge.source);
            this.ensureNode(data, edge.target);
            data.nodes[edge.source].links[edge.target] = true;
        }
    }

    private ensureNode(data: GraphData, path: string): void {
        if (!data.nodes[path]) data.nodes[path] = { type: "", links: {} };
    }
}
