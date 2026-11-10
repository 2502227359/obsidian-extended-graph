import { WorkspaceLeaf } from "obsidian";

const owners = new WeakMap<WorkspaceLeaf, { count: number; pinned: boolean }>();

/** 多个图谱功能共同持有固定状态，最后一方退出时才恢复用户原状态。 */
export function holdCenter(leaf: WorkspaceLeaf): () => void {
    let entry = owners.get(leaf);
    if (!entry) {
        entry = { count: 0, pinned: !!leaf.pinned };
        owners.set(leaf, entry);
        leaf.setPinned(true);
    }
    ++entry.count;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        if (--entry.count !== 0) return;
        owners.delete(leaf);
        leaf.setPinned(entry.pinned);
    };
}
