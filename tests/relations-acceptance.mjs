import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setup, vault, root } from './setup.mjs';
import { command, assertTestVault, evaluate } from './cli.mjs';

assertTestVault();
const sourceVault = path.resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], '请显式传入只读样本库路径');
assert.notEqual(sourceVault, path.resolve(vault));
const samplePaths = [
    '临床医学/临床医学/内科学/3.2 心力衰竭.md',
    '临床医学/基础医学/药理学/第二十六章 治疗心力衰竭的药物.md',
    '临床医学/基础医学/生理生化基础/1.4.4 心血管调节-神经调节.md',
    '临床医学/问题辨析/解析/利尿后口渴为什么不会抵消容量下降.md',
    '临床医学/基础医学/生理生化基础/1.8.5 尿生成的调节.md',
    '临床医学/基础医学/生理生化基础/1.10.4 内脏活动调节-中枢调节与本能行为.md',
];
for (const relative of samplePaths) {
    const destination = path.join(vault, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(sourceVault, relative), destination);
}
const hoverPath = '.obsidian/plugins/hover-editor-zh';
const manifest = JSON.parse(await readFile(path.join(sourceVault, hoverPath, 'manifest.json'), 'utf8'));
assert.equal(manifest.id, 'hover-editor-zh');
await mkdir(path.join(vault, hoverPath), { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
    await copyFile(path.join(sourceVault, hoverPath, file), path.join(vault, hoverPath, file));
}
await writeFile(path.join(vault, hoverPath, 'data.json'), JSON.stringify({
    headings: 'always', blocks: 'always', defaultMode: 'preview', autoFocus: true,
    autoPin: 'onMove', triggerDelay: 300,
}));
await setup();
if (!await evaluate(`app.internalPlugins.plugins['page-preview'].enabled`)) command('plugin:enable', 'id=page-preview', 'filter=core');
await evaluate(`(async()=>{await app.plugins.loadManifests();return true;})()`);
if (!await evaluate(`Boolean(app.plugins.plugins['hover-editor-zh'])`)) command('plugin:enable', 'id=hover-editor-zh');
command('plugin:reload', 'id=hover-editor-zh');
command('plugin:reload', 'id=extended-graph');
const name = '心衰真实样本的关联位置和悬浮编辑器定位';
const result = await evaluate(`app.plugins.plugins['extended-graph'].runRegression(${JSON.stringify(name)})`);
await mkdir(path.join(root, '.test-results'), { recursive: true });
await writeFile(path.join(root, '.test-results/relations-heart.json'), JSON.stringify(result, null, 2));
assert.ok(result.passed, result.error);
console.log('通过：心衰 21 个位置、34 处引用，两个标题与真实块的 Hover Editor 阅读模式定位');
const branchName = '心衰真实样本的双处预览与逐层探索';
const branchResult = await evaluate(`app.plugins.plugins['extended-graph'].runRegression(${JSON.stringify(branchName)})`);
await writeFile(path.join(root, '.test-results/branches-heart.json'), JSON.stringify(branchResult, null, 2));
assert.ok(branchResult.passed, branchResult.error);
console.log('通过：心衰真实样本的双处临时预览、逐层探索、保留分支与真实边端点');
const directName = '心衰Alt单击自动定位真实标题块和引用原文';
const directResult = await evaluate(`app.plugins.plugins['extended-graph'].runRegression(${JSON.stringify(directName)})`);
await writeFile(path.join(root, '.test-results/direct-heart.json'), JSON.stringify(directResult, null, 2));
assert.ok(directResult.passed, directResult.error);
console.log('通过：心衰 Alt 单击自动显示真实标题、切换位置、块与引用原文阅读模式定位');
