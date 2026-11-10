import assert from 'node:assert/strict';
import { readRelations } from '../src/relations/relations.ts';
import { waitFor } from './graph-fixture.mjs';

export async function relationsRace(plugin) {
    const { app } = plugin;
    const root = 'relations-race';
    const created = [];
    const originalRead = app.vault.cachedRead;
    try {
        if (!app.vault.getAbstractFileByPath(root)) await app.vault.createFolder(root);
        const source = await app.vault.create(`${root}/Source.md`, '# 来源\n\n[[Target#目标]]\n');
        created.push(source);
        const target = await app.vault.create(`${root}/Target.md`, '# 目标\n正文\n');
        created.push(target);
        await waitFor(() => app.metadataCache.getFileCache(source)?.links?.length && app.metadataCache.getFileCache(target)?.headings?.length, '竞态测试的链接缓存应就绪');
        let delayed = false;
        app.vault.cachedRead = async function (file) {
            if (file === source && !delayed) {
                delayed = true;
                await app.vault.modify(source, '# 新来源\n\n新增的说明。\n\n[[Target#目标]]\n');
                await waitFor(() => app.metadataCache.getFileCache(source)?.links?.[0]?.position.start.line === 4, '文件读取结束前应完成新位置解析');
            }
            return originalRead.call(this, file);
        };
        const groups = await readRelations(app, source.path, target.path);
        assert.equal(groups[0].occurrences[0].position.start.line, 4, '读取期间笔记变化后，不能继续使用旧行号');
        assert.equal(groups[0].occurrences[0].heading, '新来源');
        assert.equal(groups[0].occurrences[0].excerpt, '[[Target#目标]]');
    } finally {
        app.vault.cachedRead = originalRead;
        for (const file of created) if (app.vault.getAbstractFileByPath(file.path)) await app.vault.delete(file);
    }
}
