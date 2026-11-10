import assert from 'node:assert/strict';
import { NeighborIndex } from '../src/relations/neighbors.ts';
import { BranchExpansions } from '../src/graph/branchExpansions.ts';

const ROOT = 'branches-fixtures';
const PATHS = {
    a: `${ROOT}/A.md`,
    b: `${ROOT}/B.md`,
    c: `${ROOT}/C.md`,
    d: `${ROOT}/D.md`,
};
const SOURCE_ROOT = 'branches-source-fixtures';
const SOURCE_PATHS = {
    anchor: `${SOURCE_ROOT}/Anchor.md`,
    sourceTarget: `${SOURCE_ROOT}/SourceTarget.md`,
    archiveTarget: `${SOURCE_ROOT}/ArchiveTarget.md`,
    mixed: `${SOURCE_ROOT}/Mixed.md`,
    mixedTarget: `${SOURCE_ROOT}/MixedTarget.md`,
    inbound: `${SOURCE_ROOT}/Inbound.md`,
    incremental: `${SOURCE_ROOT}/Incremental.md`,
    oldTarget: `${SOURCE_ROOT}/OldTarget.md`,
    newTarget: `${SOURCE_ROOT}/NewTarget.md`,
};

async function waitForMetadata(app, paths) {
    const deadline = Date.now() + 5000;
    while (paths.some(path => !app.metadataCache.getCache(path))
        || !app.metadataCache.resolvedLinks[PATHS.b]?.[PATHS.c]
        || !app.metadataCache.resolvedLinks[PATHS.a]?.[PATHS.d]
        || !app.metadataCache.resolvedLinks[PATHS.d]?.[PATHS.c]) {
        assert.ok(Date.now() < deadline, '分支测试笔记的链接缓存应完成');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

async function waitForResolved(app, paths, links) {
    const deadline = Date.now() + 5000;
    while (paths.some(path => !app.metadataCache.getCache(path))
        || links.some(([source, target]) => !app.metadataCache.resolvedLinks[source]?.[target])) {
        assert.ok(Date.now() < deadline, '来源关系测试的链接缓存应完成');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

async function waitForCondition(condition, message) {
    const deadline = Date.now() + 5000;
    while (!condition()) {
        assert.ok(Date.now() < deadline, message);
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

function graphData(paths) {
    const nodes = Object.fromEntries(paths.map(path => [path, { type: '', links: {} }]));
    return { nodes, numLinks: 0 };
}

export async function branchesData(plugin) {
    const { app } = plugin;
    const created = [];
    const index = new NeighborIndex(app);
    index.load();
    try {
        if (!app.vault.getAbstractFileByPath(ROOT)) await app.vault.createFolder(ROOT);
        created.push(await app.vault.create(PATHS.a, '[[branches-fixtures/B]]\n[[branches-fixtures/D]]'));
        created.push(await app.vault.create(PATHS.b, '[[branches-fixtures/C]]'));
        created.push(await app.vault.create(PATHS.c, 'C'));
        created.push(await app.vault.create(PATHS.d, '[[branches-fixtures/C]]'));
        await waitForMetadata(app, Object.values(PATHS));

        const branch = index.getOneHop(PATHS.b, {
            incoming: true,
            outgoing: true,
            interlinks: false,
            includeSources: true,
        });
        assert.deepEqual(branch.nodes, [PATHS.b, PATHS.a, PATHS.c]);
        assert.deepEqual(branch.edges, [
            { source: PATHS.a, target: PATHS.b },
            { source: PATHS.b, target: PATHS.c },
        ]);
        assert.equal(branch.total, 2, 'B 的一跳邻居应为 A、C');

        const base = graphData([PATHS.a, PATHS.b, PATHS.c]);
        base.nodes[PATHS.a].links[PATHS.b] = true;
        base.nodes[PATHS.b].links[PATHS.c] = true;
        base.numLinks = 2;
        const expansions = new BranchExpansions();
        expansions.toggle(PATHS.b);
        expansions.toggle(PATHS.d);
        const merged = expansions.compose(base, path => index.getOneHop(path, {
            incoming: true,
            outgoing: true,
            interlinks: false,
            includeSources: true,
        }));
        assert.equal(merged.numLinks, 4, '两个分支合并后应去重保留 4 条有向边');
        assert.ok(merged.nodes[PATHS.d], 'D 应由第二个分支加入');
        assert.ok(merged.nodes[PATHS.c], '共享节点 C 不应丢失');
        assert.equal(base.numLinks, 2, '合并不应修改基础图的链接数');
        assert.equal(base.nodes[PATHS.d], undefined, '合并不应把 D 写入基础图');

        expansions.toggle(PATHS.d);
        const collapsed = expansions.compose(base, path => index.getOneHop(path, {
            incoming: true,
            outgoing: true,
            interlinks: false,
            includeSources: true,
        }));
        assert.equal(collapsed.numLinks, 2, '收起 D 分支后应保留基础图与 B 分支的边');
        assert.ok(collapsed.nodes[PATHS.c], '收起共享分支时不应删除基础图中的 C');
        expansions.clear();
        expansions.keep(PATHS.c, [{ source: PATHS.a, target: PATHS.b }, { source: PATHS.b, target: PATHS.c }]);
        const retained = expansions.compose(graphData([PATHS.a]), path => index.getOneHop(path, {
            incoming: true, outgoing: true, interlinks: false, includeSources: true,
        }));
        assert.equal(retained.nodes[PATHS.a].links[PATHS.b], true, '保留深层分支时应保留真实进入路径');
        console.log('分支数据测试通过');
    } finally {
        index.unload();
        for (const file of created.reverse()) {
            if (app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file);
        }
    }
}

export async function branchesSources(plugin) {
    const { app } = plugin;
    const created = [];
    const index = new NeighborIndex(app);
    index.load();
    const ordinaryTargets = Array.from({ length: 22 }, (_, index) =>
        `${SOURCE_ROOT}/N${String(index + 1).padStart(2, '0')}.md`);
    try {
        if (!app.vault.getAbstractFileByPath(SOURCE_ROOT)) await app.vault.createFolder(SOURCE_ROOT);
        for (const path of ordinaryTargets) created.push(await app.vault.create(path, path));
        created.push(await app.vault.create(SOURCE_PATHS.sourceTarget, '# 来源章节\n内容'));
        created.push(await app.vault.create(SOURCE_PATHS.archiveTarget, '# 归档章节\n内容'));
        created.push(await app.vault.create(SOURCE_PATHS.mixedTarget, '# 混合章节\n内容'));
        created.push(await app.vault.create(SOURCE_PATHS.oldTarget, '旧目标'));
        created.push(await app.vault.create(SOURCE_PATHS.newTarget, '新目标'));
        created.push(await app.vault.create(SOURCE_PATHS.anchor, [
            '---',
            `source: "[[${SOURCE_PATHS.sourceTarget.slice(0, -3)}#来源章节]]"`,
            'source_archive:',
            `  - "[[${SOURCE_PATHS.archiveTarget.slice(0, -3)}#归档章节]]"`,
            '---',
            ...ordinaryTargets.map(path => `[[${path.slice(0, -3)}]]`),
            `[[${SOURCE_PATHS.anchor.slice(0, -3)}]]`,
        ].join('\n')));
        created.push(await app.vault.create(SOURCE_PATHS.mixed, [
            '---',
            `source: "[[${SOURCE_PATHS.mixedTarget.slice(0, -3)}#混合章节]]"`,
            '---',
            `正文保留 [[${SOURCE_PATHS.mixedTarget.slice(0, -3)}#混合章节]]。`,
        ].join('\n')));
        created.push(await app.vault.create(SOURCE_PATHS.inbound,
            `[[${SOURCE_PATHS.anchor.slice(0, -3)}]]`));
        created.push(await app.vault.create(SOURCE_PATHS.incremental,
            `[[${SOURCE_PATHS.oldTarget.slice(0, -3)}]]`));
        await waitForResolved(app, [
            ...ordinaryTargets,
            SOURCE_PATHS.anchor,
            SOURCE_PATHS.sourceTarget,
            SOURCE_PATHS.archiveTarget,
            SOURCE_PATHS.mixed,
            SOURCE_PATHS.mixedTarget,
            SOURCE_PATHS.inbound,
            SOURCE_PATHS.incremental,
            SOURCE_PATHS.oldTarget,
            SOURCE_PATHS.newTarget,
        ], [
            [SOURCE_PATHS.anchor, ordinaryTargets[0]],
            [SOURCE_PATHS.anchor, SOURCE_PATHS.sourceTarget],
            [SOURCE_PATHS.anchor, SOURCE_PATHS.archiveTarget],
            [SOURCE_PATHS.mixed, SOURCE_PATHS.mixedTarget],
            [SOURCE_PATHS.incremental, SOURCE_PATHS.oldTarget],
            [SOURCE_PATHS.inbound, SOURCE_PATHS.anchor],
        ]);

        const hiddenBranch = index.getOneHop(SOURCE_PATHS.anchor, {
            incoming: false,
            outgoing: true,
            interlinks: false,
            includeSources: false,
        });
        assert.equal(hiddenBranch.total, 22, '来源边隐藏后 total 应只统计可见邻居');
        assert.equal(hiddenBranch.hidden, 2, 'hidden 应统计 source/source_archive 来源边');
        assert.equal(hiddenBranch.nodes.length, 21, '默认 limit20 应保留中心加 20 个邻居');
        assert.deepEqual(hiddenBranch.nodes.slice(1), ordinaryTargets.slice(0, 20),
            '邻居应按路径稳定排序并分页');
        assert.ok(!hiddenBranch.nodes.includes(SOURCE_PATHS.sourceTarget));
        assert.ok(!hiddenBranch.nodes.includes(SOURCE_PATHS.archiveTarget));

        const sourcesVisible = index.getOneHop(SOURCE_PATHS.anchor, {
            incoming: false,
            outgoing: true,
            interlinks: false,
            includeSources: true,
            limit: 40,
        });
        assert.equal(sourcesVisible.total, 24, '允许来源边时应统计全部 24 个邻居');
        assert.equal(sourcesVisible.hidden, 0, '允许来源边时 hidden 应为 0');
        assert.ok(sourcesVisible.nodes.includes(SOURCE_PATHS.sourceTarget));
        assert.ok(sourcesVisible.nodes.includes(SOURCE_PATHS.archiveTarget));
        assert.equal(sourcesVisible.nodes.filter(path => path === SOURCE_PATHS.anchor).length, 1,
            '自环不应重复加入节点');
        assert.ok(!sourcesVisible.edges.some(edge => edge.source === SOURCE_PATHS.anchor
            && edge.target === SOURCE_PATHS.anchor), '自环不应产生图边');

        const hiddenIncoming = index.getOneHop(SOURCE_PATHS.sourceTarget, {
            incoming: true,
            outgoing: false,
            interlinks: false,
            includeSources: false,
        });
        assert.deepEqual(hiddenIncoming.nodes, [SOURCE_PATHS.sourceTarget],
            '默认也应隐藏指向来源目标的来源入链');
        const visibleIncoming = index.getOneHop(SOURCE_PATHS.sourceTarget, {
            incoming: true,
            outgoing: false,
            interlinks: false,
            includeSources: true,
        });
        assert.ok(visibleIncoming.nodes.includes(SOURCE_PATHS.anchor), '允许来源边时应显示来源入链');

        const incoming = index.getOneHop(SOURCE_PATHS.anchor, {
            incoming: true,
            outgoing: false,
            interlinks: false,
            includeSources: true,
        });
        assert.deepEqual(incoming.nodes, [SOURCE_PATHS.anchor, SOURCE_PATHS.inbound]);
        assert.deepEqual(incoming.edges, [{ source: SOURCE_PATHS.inbound, target: SOURCE_PATHS.anchor }]);

        const mixed = index.getOneHop(SOURCE_PATHS.mixed, {
            incoming: false,
            outgoing: true,
            interlinks: false,
            includeSources: false,
        });
        assert.deepEqual(mixed.nodes, [SOURCE_PATHS.mixed, SOURCE_PATHS.mixedTarget],
            'source 属性与正文同时引用时应保留正文关系');
        assert.equal(mixed.hidden, 0);

        const exam = await app.vault.create(`${SOURCE_ROOT}/Exam.md`, `---\npage_type: exam_source\n---\n[[${SOURCE_PATHS.anchor.slice(0, -3)}]]`);
        created.push(exam);
        await waitForResolved(app, [exam.path], [[exam.path, SOURCE_PATHS.anchor]]);
        assert.deepEqual(index.getOneHop(SOURCE_PATHS.anchor, {
            incoming: true, outgoing: false, interlinks: false, includeSources: false,
        }).nodes, [SOURCE_PATHS.anchor, SOURCE_PATHS.inbound], '来源页作为入链时也应默认隐藏');
        assert.ok(index.getOneHop(SOURCE_PATHS.anchor, {
            incoming: true, outgoing: false, interlinks: false, includeSources: true,
        }).nodes.includes(exam.path), '明确开启来源后应显示来源页入链');

        await app.vault.modify(app.vault.getAbstractFileByPath(SOURCE_PATHS.oldTarget), `[[${SOURCE_PATHS.incremental.slice(0, -3)}]]`);
        await waitForResolved(app, [SOURCE_PATHS.oldTarget], [[SOURCE_PATHS.oldTarget, SOURCE_PATHS.incremental]]);
        assert.deepEqual(index.getOneHop(SOURCE_PATHS.incremental, {
            incoming: false, outgoing: true, interlinks: false, includeSources: true,
        }).edges, [{ source: SOURCE_PATHS.incremental, target: SOURCE_PATHS.oldTarget }], '仅出链时不能补入同一对节点的反向边');

        await app.vault.modify(app.vault.getAbstractFileByPath(SOURCE_PATHS.incremental),
            `[[${SOURCE_PATHS.newTarget.slice(0, -3)}]]`);
        await waitForResolved(app, [SOURCE_PATHS.incremental], [[SOURCE_PATHS.incremental, SOURCE_PATHS.newTarget]]);
        const updated = index.getOneHop(SOURCE_PATHS.incremental, {
            incoming: false,
            outgoing: true,
            interlinks: false,
            includeSources: true,
        });
        assert.deepEqual(updated.nodes, [SOURCE_PATHS.incremental, SOURCE_PATHS.newTarget],
            '编辑 source 后已加载索引应按源增量更新');
        assert.ok(!updated.nodes.includes(SOURCE_PATHS.oldTarget));

        await app.vault.delete(app.vault.getAbstractFileByPath(SOURCE_PATHS.incremental));
        await waitForResolved(app, [SOURCE_PATHS.newTarget], []);
        await waitForCondition(() => index.getOneHop(SOURCE_PATHS.newTarget, {
            incoming: true,
            outgoing: false,
            interlinks: false,
            includeSources: true,
        }).nodes.length === 1, '删除来源文件后索引应完成失效');
        const afterDelete = index.getOneHop(SOURCE_PATHS.newTarget, {
            incoming: true,
            outgoing: false,
            interlinks: false,
            includeSources: true,
        });
        assert.deepEqual(afterDelete.nodes, [SOURCE_PATHS.newTarget], '删除来源文件后入链应安全失效');
        console.log('来源与增量索引测试通过');
    } finally {
        index.unload();
        for (const file of created.reverse()) {
            if (app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file);
        }
    }
}
