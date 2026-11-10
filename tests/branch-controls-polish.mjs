import assert from 'node:assert/strict';
import { ExtendedGraphInstances } from '../src/pluginInstances.ts';
import { waitFor } from './graph-fixture.mjs';

function isUnavailable(element) {
    if (!element) return true;
    for (let current = element; current; current = current.parentElement) {
        if (current.hidden || current.getAttribute('aria-hidden') === 'true') return true;
    }
    return element.disabled
        || element.getAttribute('aria-disabled') === 'true'
        || element.classList.contains('is-disabled');
}

function assertPage(panel, current, total) {
    assert.equal(panel.dataset.page, String(current), '面板应暴露当前页码');
    assert.equal(panel.dataset.pages, String(total), '面板应暴露总页数');
    const indicator = panel.querySelector('[data-page-indicator]');
    assert.ok(indicator, '多批预览应显示页码指示器');
    const numbers = [...indicator.textContent.matchAll(/\d+/g)].map(match => Number(match[0]));
    assert.deepEqual(numbers.slice(-2), [current, total], '页码指示器应显示当前页与总页数');
}

function getPageButton(panel, action) {
    return panel.querySelector(`.eg-branch-preview-action[data-action="${action}"]`);
}

async function createSingleFixture(app, root, created) {
    const files = [];
    const rootFile = await app.vault.create(`${root}/Root.md`, '[[Anchor]]\n');
    files.push(rootFile);
    created.push(rootFile);
    const anchor = await app.vault.create(`${root}/Anchor.md`, '[[One]]\n');
    files.push(anchor);
    created.push(anchor);
    const one = await app.vault.create(`${root}/One.md`, '# One\n');
    files.push(one);
    created.push(one);
    await waitFor(() => app.metadataCache.resolvedLinks[files[0].path]?.[files[1].path]
        && app.metadataCache.resolvedLinks[files[1].path]?.[files[2].path], '单批样本链接应完成解析');
    return files;
}

async function createPagedFixture(app, root, created) {
    const files = [];
    const anchor = await app.vault.create(`${root}/PagedAnchor.md`, '');
    created.push(anchor);
    const targets = [];
    for (let index = 1; index <= 21; ++index) {
        const target = await app.vault.create(`${root}/N${String(index).padStart(2, '0')}.md`, `# N${index}\n`);
        targets.push(target);
        created.push(target);
    }
    await app.vault.modify(anchor, targets.map(file => `[[${file.path.slice(0, -3)}]]`).join(' '));
    const rootFile = await app.vault.create(`${root}/PagedRoot.md`, `[[${anchor.path.slice(0, -3)}]]\n`);
    created.push(rootFile);
    files.push(rootFile, anchor, ...targets);
    await waitFor(() => app.metadataCache.resolvedLinks[rootFile.path]?.[anchor.path]
        && targets.every(file => app.metadataCache.resolvedLinks[anchor.path]?.[file.path]), '多批样本链接应完成解析');
    return files;
}

async function openFixture(plugin, rootPath, anchorPath) {
    const leaf = plugin.app.workspace.getLeaf('tab');
    leaf.setPinned(true);
    await leaf.setViewState({ type: 'localgraph', state: { file: rootPath }, active: true });
    await waitFor(() => leaf.view.renderer?.nodes.some(node => node.id === anchorPath), '局部图谱应显示悬浮锚点');
    leaf.setPinned(false);
    const manager = ExtendedGraphInstances.graphsManager;
    manager.graphLeavesManager.initLeaf(leaf);
    manager.lifecycleManager.enablePlugin(leaf.view, undefined, false);
    await waitFor(() => manager.allInstances.get(leaf.id)?.graphEventsDispatcher.inputsManager, '局部图谱增强应完成初始化');
    return leaf;
}

async function showBranch(leaf, anchorPath) {
    const toggle = leaf.view.contentEl.querySelector('.eg-hover-branches-toggle');
    assert.ok(toggle, '局部图谱应有悬浮关联开关');
    if (toggle.getAttribute('aria-pressed') !== 'true') toggle.click();
    leaf.view.renderer.onNodeHover(new MouseEvent('mousemove', { clientX: 500, clientY: 350 }), anchorPath, '');
    await waitFor(() => {
        const panel = leaf.view.contentEl.querySelector('.eg-branch-preview');
        return panel?.dataset.anchor === anchorPath && !panel.hidden;
    }, '悬浮预览应显示目标节点分支');
    await waitFor(() => leaf.view.renderer.hanger.children.find(child => child.name === 'eg-branch-layer')?.alpha > 0.9,
        '主图临时层应完成淡入');
    return leaf.view.contentEl.querySelector('.eg-branch-preview');
}

async function assertSingleControls(leaf, files) {
    const panel = await showBranch(leaf, files[1].path);
    assert.equal(Number(panel.dataset.total) <= 20, true, '单批样本应不超过一页');
    assert.ok(isUnavailable(getPageButton(panel, 'page-prev')), '单批预览不应提供可用的上一批操作');
    assert.ok(isUnavailable(getPageButton(panel, 'page-next')), '单批预览不应提供可用的下一批操作');
    const retain = panel.querySelector('.eg-branch-preview-action[data-action="retain"]');
    assert.ok(retain, '预览应提供保留当前层操作');
    retain.click();
    const controller = ExtendedGraphInstances.graphsManager.allInstances.get(leaf.id).graphEventsDispatcher.branches;
    await waitFor(() => controller.expansions.anchors.has(files[1].path)
        && panel.querySelector('.eg-branch-preview-action[data-action="retain"]')?.textContent.includes('已保留')
        && isUnavailable(panel.querySelector('.eg-branch-preview-action[data-action="retain"]')),
    '保留当前层后按钮应显示已保留并禁用');
}

async function assertPagedControls(leaf, files) {
    const panel = await showBranch(leaf, files[1].path);
    const total = Number(panel.dataset.total);
    const pages = Math.ceil(total / 20);
    assert.ok(total > 20 && pages > 1, '多批样本应产生至少两页');
    assertPage(panel, 1, pages);
    assert.ok(isUnavailable(getPageButton(panel, 'page-prev')), '第一页应禁用上一批');
    assert.equal(isUnavailable(getPageButton(panel, 'page-next')), false, '第一页应启用下一批');
    getPageButton(panel, 'page-next').click();
    await waitFor(() => panel.dataset.page === String(pages), '点击下一批应进入末页');
    assertPage(panel, pages, pages);
    assert.equal(isUnavailable(getPageButton(panel, 'page-prev')), false, '末页应启用上一批');
    assert.ok(isUnavailable(getPageButton(panel, 'page-next')), '末页应禁用下一批');
    getPageButton(panel, 'page-prev').click();
    await waitFor(() => panel.dataset.page === '1', '点击上一批应返回首页');
    assertPage(panel, 1, pages);
    assert.ok(isUnavailable(getPageButton(panel, 'page-prev')), '返回首页后应再次禁用上一批');
}

export async function branchControlsPolish(plugin) {
    const root = `branch-controls-polish-${Date.now()}`;
    const created = [], singleFiles = [], pagedFiles = [];
    let singleLeaf, pagedLeaf;
    try {
        await plugin.app.vault.createFolder(root);
        singleFiles.push(...await createSingleFixture(plugin.app, root, created));
        pagedFiles.push(...await createPagedFixture(plugin.app, root, created));
        singleLeaf = await openFixture(plugin, singleFiles[0].path, singleFiles[1].path);
        await assertSingleControls(singleLeaf, singleFiles);
        pagedLeaf = await openFixture(plugin, pagedFiles[0].path, pagedFiles[1].path);
        await assertPagedControls(pagedLeaf, pagedFiles);
    } finally {
        singleLeaf?.detach();
        pagedLeaf?.detach();
        for (const file of created) {
            if (plugin.app.vault.getAbstractFileByPath(file.path)) await plugin.app.vault.delete(file);
        }
    }
}
