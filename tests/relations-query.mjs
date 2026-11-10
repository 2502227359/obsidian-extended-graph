import assert from 'node:assert/strict';
import { readRelations } from '../src/relations/relations.ts';

const ROOT = 'relations-fixtures';
const CENTER_PATH = `${ROOT}/Center.md`;
const NEIGHBOR_PATH = `${ROOT}/Neighbor.md`;

async function waitForMetadata(app, paths) {
    const deadline = Date.now() + 5000;
    while (paths.some(path => !app.metadataCache.getCache(path))) {
        assert.ok(Date.now() < deadline, '关系测试笔记的链接缓存应完成');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

function groupBySubpath(groups, direction, subpath) {
    return groups.find(group => group.direction === direction && group.subpath === subpath);
}

export async function relationsQuery(plugin) {
    const { app } = plugin;
    const created = [];
    try {
        if (!app.vault.getAbstractFileByPath(ROOT)) await app.vault.createFolder(ROOT);
        created.push(await app.vault.create(CENTER_PATH, [
            '# 中心',
            '',
            '## 出链',
            '[[relations-fixtures/Neighbor#目标|别名一]]',
            '[[relations-fixtures/Neighbor#目标|别名二]]',
            '[[relations-fixtures/Neighbor#^anchor|块引用]]',
            '[[relations-fixtures/Neighbor]]',
            '',
            '## 来源',
            '中心的来源段落。',
            '',
        ].join('\n')));
        created.push(await app.vault.create(NEIGHBOR_PATH, [
            '# 目标',
            '目标段落。',
            '块引用段落。 ^anchor',
            '',
            '# 来源',
            '[[relations-fixtures/Center#来源]]',
            '',
        ].join('\n')));
        await waitForMetadata(app, [CENTER_PATH, NEIGHBOR_PATH]);

        const groups = await readRelations(app, CENTER_PATH, NEIGHBOR_PATH);
        assert.equal(groups.length, 4, '应按方向和锚点合并为 4 组关系');
        assert.equal(groups.filter(group => group.direction === 'outgoing').length, 3, '出链应有标题、块和普通文件 3 组');
        assert.equal(groups.filter(group => group.direction === 'incoming').length, 1, '入链应有 1 组');
        assert.equal(groups.reduce((total, group) => total + group.occurrences.length, 0), 5, '关系组应保留全部 5 次引用');

        const headingGroup = groupBySubpath(groups, 'outgoing', '#目标');
        assert.ok(headingGroup, '应保留标题锚点');
        assert.equal(headingGroup.status, 'valid');
        assert.equal(headingGroup.occurrences.length, 2, '同一标题的两次引用应合并并保留次数');
        assert.equal(headingGroup.sourcePath, CENTER_PATH);
        assert.equal(headingGroup.targetPath, NEIGHBOR_PATH);
        assert.ok(headingGroup.label);
        assert.ok(headingGroup.occurrences.every(occurrence => occurrence.heading === '出链'));
        assert.ok(headingGroup.occurrences.every(occurrence => occurrence.position?.start?.line >= 0));

        const blockGroup = groupBySubpath(groups, 'outgoing', '#^anchor');
        assert.ok(blockGroup, '应保留块 ID 锚点');
        assert.equal(blockGroup.status, 'valid');
        assert.equal(blockGroup.occurrences.length, 1);
        assert.ok(blockGroup.occurrences[0].original.includes('#^anchor'));

        const fileGroup = groupBySubpath(groups, 'outgoing', '');
        assert.ok(fileGroup, '无锚点链接应降级为文件级关系');
        assert.equal(fileGroup.status, 'file');
        assert.equal(fileGroup.occurrences.length, 1);

        const incomingGroup = groups.find(group => group.direction === 'incoming');
        assert.equal(incomingGroup.sourcePath, NEIGHBOR_PATH);
        assert.equal(incomingGroup.targetPath, CENTER_PATH);
        assert.equal(incomingGroup.subpath, '#来源');
        assert.equal(incomingGroup.status, 'valid');
        assert.equal(incomingGroup.occurrences[0].heading, '来源');
        assert.ok(incomingGroup.occurrences[0].original.includes('#来源'));
    } finally {
        for (const file of created.reverse()) {
            if (app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file);
        }
    }
}

export async function relationsLocations(plugin) {
    const { app } = plugin;
    const root = 'relations-locations';
    const centerPath = `${root}/Center.md`;
    const neighborPath = `${root}/Neighbor.md`;
    const created = [];
    try {
        if (!app.vault.getAbstractFileByPath(root)) await app.vault.createFolder(root);
        created.push(await app.vault.create(centerPath, [
            '# 中心',
            '',
            '[[relations-locations/Neighbor#目标]]',
            '[别名](Neighbor.md#%E7%9B%AE%E6%A0%87)',
            '[[relations-locations/Neighbor]]',
            '[[relations-locations/Neighbor#^missing]]',
            '[[relations-locations/Neighbor#重复]]',
            '',
        ].join('\n')));
        created.push(await app.vault.create(neighborPath, [
            '# 目标',
            '目标段落。',
            '',
            '# 重复',
            '第一个同名标题。',
            '',
            '# 重复',
            '第二个同名标题。',
            '',
        ].join('\n')));
        await waitForMetadata(app, [centerPath, neighborPath]);

        const groups = await readRelations(app, centerPath, neighborPath);
        assert.equal(groups.length, 4, '同一方向的 4 种定位结果应形成 4 组');
        assert.equal(groups.reduce((total, group) => total + group.occurrences.length, 0), 5, '应保留 5 次原始引用');

        const headingGroup = groupBySubpath(groups, 'outgoing', '#目标');
        assert.ok(headingGroup, 'Wiki 链接和 Markdown 链接应归一到同一标题');
        assert.equal(headingGroup.status, 'valid');
        assert.equal(headingGroup.occurrences.length, 2, '不同链接语法指向同一标题时应保留两次引用');
        assert.ok(headingGroup.occurrences.some(occurrence => occurrence.original.includes('别名')));

        const fileGroup = groupBySubpath(groups, 'outgoing', '');
        assert.ok(fileGroup, '无锚点链接应保留为文件级关系');
        assert.equal(fileGroup.status, 'file');
        assert.equal(fileGroup.occurrences.length, 1);

        const missingGroup = groupBySubpath(groups, 'outgoing', '#^missing');
        assert.ok(missingGroup, '失效块 ID 应保留原始定位');
        assert.equal(missingGroup.status, 'missing');
        assert.equal(missingGroup.occurrences.length, 1);

        const ambiguousGroup = groupBySubpath(groups, 'outgoing', '#重复');
        assert.ok(ambiguousGroup, '重复标题应保留原始定位');
        assert.equal(ambiguousGroup.status, 'ambiguous');
        assert.equal(ambiguousGroup.occurrences.length, 1);
    } finally {
        for (const file of created.reverse()) {
            if (app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file);
        }
    }
}
