import assert from 'node:assert/strict';
import { holdCenter } from '../src/graph/centerPin.ts';

export async function centerPin(plugin) {
    const leaf = plugin.app.workspace.getLeaf('tab');
    try {
        leaf.setPinned(false);
        const releasePanel = holdCenter(leaf);
        const releasePreview = holdCenter(leaf);
        releasePanel();
        assert.equal(leaf.pinned, true, '另一使用方仍需要固定时不能提前解除');
        releasePanel();
        assert.equal(leaf.pinned, true, '重复释放不能影响另一使用方');
        releasePreview();
        assert.equal(leaf.pinned, false, '最后一方退出后恢复原状态');
        leaf.setPinned(true);
        holdCenter(leaf)();
        assert.equal(leaf.pinned, true, '用户原先固定的视图保持固定');
    } finally {
        leaf.detach();
    }
}
