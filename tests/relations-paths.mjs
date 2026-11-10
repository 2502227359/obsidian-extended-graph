import assert from 'node:assert/strict';
import { readRelations } from '../src/relations/relations.ts';
import { waitFor } from './graph-fixture.mjs';

export async function relationsPaths(plugin) {
    const { app } = plugin;
    const created = [];
    const root = 'relations-paths';
    try {
        for (const folder of [root, `${root}/a`, `${root}/b`]) {
            if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
        }
        const source = await app.vault.create(`${root}/a/Center.md`, [
            '---', 'source: "[[relations-paths/b/Neighbor]]"', '---',
            '# 来源', '[[Neighbor#目标]]', '[[relations-paths/b/Neighbor#目标|另一篇]]',
            '![[relations-paths/b/Neighbor#目标]]', '',
        ].join('\n'));
        created.push(source);
        const local = await app.vault.create(`${root}/a/Neighbor.md`, '# 目标\n同目录笔记\n');
        created.push(local);
        const other = await app.vault.create(`${root}/b/Neighbor.md`, '# 目标\n另一目录笔记\n');
        created.push(other);
        await waitFor(() => app.metadataCache.getFileCache(source)?.frontmatterLinks?.length === 1
            && app.metadataCache.getFileCache(source)?.embeds?.length === 1
            && app.metadataCache.getFileCache(local)?.headings?.length
            && app.metadataCache.getFileCache(other)?.headings?.length, '同名路径、属性和嵌入应完成解析');
        const localGroups = await readRelations(app, source.path, local.path);
        assert.equal(localGroups.length, 1, '裸链接应遵循宿主解析到同目录文件');
        assert.equal(localGroups[0].occurrences.length, 1);
        const otherGroups = await readRelations(app, source.path, other.path);
        assert.equal(otherGroups.length, 2, '完整路径应准确区分另一个同名文件');
        const heading = otherGroups.find(group => group.subpath === '#目标');
        assert.equal(heading.occurrences.length, 2, '正文和嵌入指向同一位置时保留两处证据');
        assert.ok(heading.occurrences.some(item => item.original.startsWith('!')));
        const property = otherGroups.find(group => group.subpath === '').occurrences[0];
        assert.equal(property.property, 'source');
        assert.equal(property.heading, '属性：source');
        assert.equal(property.position, undefined, '属性引用不得伪造正文行号');
    } finally {
        for (const file of created) if (app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file);
    }
}
