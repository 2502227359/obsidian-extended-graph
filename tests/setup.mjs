import { build } from 'esbuild';
import { mkdir, writeFile, copyFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const vault = path.join(root, '.test-vault');
export const pluginDirectory = path.join(vault, '.obsidian/plugins/extended-graph');

async function seed(relativePath, content) {
    const destination = path.join(vault, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    try {
        await access(destination);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await writeFile(destination, content);
    }
}

export async function setup() {
    await mkdir(pluginDirectory, { recursive: true });
    await seed('.obsidian/app.json', JSON.stringify({ alwaysUpdateLinks: true }));
    await seed('.obsidian/community-plugins.json', JSON.stringify(['extended-graph']));
    await seed('.obsidian/core-plugins.json', JSON.stringify(['file-explorer', 'global-search', 'graph', 'backlink', 'properties', 'outgoing-link']));
    await seed('测试说明.md', '# Extended Graph 独立测试库\n\n本库只含自动生成的测试笔记，可用于插件回归与界面验收。\n\n[[notes/A]] [[notes/B]] [[outside/X]]\n');
    await seed('notes/A.md', '---\ntags: [alpha]\nstatus: draft\n---\n# A\n\n[[B]]\n');
    await seed('notes/B.md', '# B\n');
    await seed('notes/C.md', '# C\n');
    await seed('notes/Pre.md', '# 共同引用\n\n[[A]] 和 [[B]] 出现在同一段落。\n');
    await seed('outside/X.md', '---\ntags: [outside]\n---\n# 独立节点\n');
    await copyFile(path.join(root, 'manifest.json'), path.join(pluginDirectory, 'manifest.json'));
    await copyFile(path.join(root, 'styles.css'), path.join(pluginDirectory, 'styles.css'));
    await build({
        entryPoints: [path.join(root, 'tests/plugin-entry.mjs')],
        outfile: path.join(pluginDirectory, 'main.js'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'es2021',
        external: ['obsidian', 'electron'],
        sourcemap: 'inline',
    });
    return vault;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    console.log(`测试库：${await setup()}`);
}
