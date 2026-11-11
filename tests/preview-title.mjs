import assert from 'node:assert/strict';
import { appearanceFixture, showAppearance } from './graph-appearance.mjs';
import { polishFixture, cleanPolish } from './relations-polish.mjs';
import { waitFor } from './graph-fixture.mjs';

export async function previewLongTitle(plugin) {
    const fixture = await polishFixture(plugin), { app, leaf, files } = fixture;
    const name = '1.10.4 ' + '交感神经、副交感神经与迷走神经对心脏功能的影响及其调节机制'.repeat(3);
    try {
        const file = await app.vault.create('relations-polish/' + name + '.md', '# 神经调节');
        files.push(file);
        await app.vault.modify(files[1], `# 常用药物\n[[${file.path}]]`);
        await waitFor(() => app.metadataCache.resolvedLinks[files[1].path]?.[file.path], '长名称样本应完成索引');
        const mini = await showAppearance(fixture);
        mini.querySelector(`g[data-path="${file.path}"]`).dispatchEvent(new MouseEvent('pointerenter', { clientX: 560, clientY: 390 }));
        await waitFor(() => mini.dataset.anchor === file.path, '应进入长名称节点');
        const title = mini.querySelector('.eg-branch-preview-name');
        assert.equal(title?.textContent, name, '当前笔记标题应保留完整文件名与编号');
        assert.equal(title.title, file.path, '标题应提供完整路径');
        const expand = mini.querySelector('.eg-branch-preview-title-toggle');
        await waitFor(() => expand && !expand.hidden, '超出三行时应提供展开入口');
        assert.equal(getComputedStyle(title).webkitLineClamp, '3');
        expand.click();
        assert.equal(expand.getAttribute('aria-expanded'), 'true');
        assert.ok(title.clientHeight >= title.scrollHeight - 1, '展开后名称不能继续被裁切');
        assert.ok(mini.scrollWidth <= mini.clientWidth + 1, '长名称不能造成横向溢出');
        expand.click();
        assert.equal(expand.getAttribute('aria-expanded'), 'false');
        const ancestor = mini.querySelector(`.eg-branch-preview-trail-path[data-path="${files[1].path}"]`);
        assert.ok(ancestor, '祖先路径应独立保留');
        ancestor.click();
        await waitFor(() => mini.dataset.anchor === files[1].path, '点击祖先应返回上一层');
        assert.equal(mini.querySelector('.eg-branch-preview-name').textContent, 'Target');
        assert.ok(leaf.view.contentEl.contains(mini));
    } finally { await cleanPolish(fixture); }
}

export async function previewSameNameTitle(plugin) {
    const fixture = await appearanceFixture(plugin), { files } = fixture;
    try {
        const mini = await showAppearance(fixture);
        mini.querySelector(`g[data-path="${files[2].path}"]`).dispatchEvent(new MouseEvent('pointerenter', { clientX: 560, clientY: 390 }));
        await waitFor(() => mini.dataset.anchor === files[2].path, '应进入同名节点');
        assert.equal(mini.querySelector('.eg-branch-preview-name')?.textContent, '1.10.4 内脏活动调节-中枢调节与本能行为');
        assert.equal(mini.querySelector('.eg-branch-preview-name')?.title, files[2].path);
        assert.ok(mini.querySelectorAll('.eg-branch-preview-trail-path').length > 0);
    } finally { await cleanPolish(fixture); }
}
