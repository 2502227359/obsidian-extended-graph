import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root, pluginDirectory } from './setup.mjs';
import { command, evaluate, assertTestVault } from './cli.mjs';

async function waitFor(code, message) {
    const deadline = Date.now() + 10000;
    while (!await evaluate(code)) {
        assert.ok(Date.now() < deadline, message);
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

assertTestVault();
await evaluate(`(()=>{app.setting.close();for(const leaf of app.workspace.getLeavesOfType('graph'))leaf.detach();return true;})()`);
await mkdir(path.join(root, '.test-results'), { recursive: true });
await copyFile(path.join(root, 'main.js'), path.join(pluginDirectory, 'main.js'));
const dataPath = path.join(pluginDirectory, 'data.json');
const data = JSON.parse(await readFile(dataPath, 'utf8'));
data.enableFeatures.graph.tags = true;
data.collapseLegend = false;
data.collapseState = false;
await writeFile(dataPath, JSON.stringify(data, null, 2));
command('plugin:reload', 'id=extended-graph');
const leafId = await evaluate(`(async()=>{const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'graph',active:true});return leaf.id;})()`);
const view = `app.workspace.getLeafById(${JSON.stringify(leafId)}).view`;
const toggle = `${view}.contentEl.querySelector('.mod-extended-graph-toggle')`;
await waitFor(`${toggle} && ${view}.renderer.nodes.length>0`, '核心图谱与插件控件应显示');
await evaluate(`${view}.contentEl.querySelector('.graph-controls .mod-close').click()`);
await waitFor(`${toggle}.getBoundingClientRect().width>0`, '启用按钮应可见');
await evaluate(`${toggle}.click()`);
await waitFor(`${toggle}.classList.contains('is-active')`, '增强图谱应启用');
await waitFor(`${view}.contentEl.querySelector('.graph-legend-container')?.textContent.includes('alpha')`, '标签图例应完成初始化');
command('plugin:disable', 'id=extended-graph');
assert.equal(await evaluate(`${view}.contentEl.querySelectorAll('.mod-extended-graph-toggle').length`), 0);
assert.ok(await evaluate(`${view}.renderer.nodes.length>0`));
command('plugin:enable', 'id=extended-graph');
await waitFor(`${toggle}`, '重启后应恢复控件');
assert.equal(await evaluate(`${view}.contentEl.querySelectorAll('.mod-extended-graph-toggle').length`), 1);
await evaluate(`${toggle}.click()`);
await waitFor(`${toggle}.classList.contains('is-active')`, '重启后应能启用增强图谱');
await waitFor(`${view}.contentEl.querySelector('.graph-legend-container')?.textContent.includes('alpha')`, '重启后标签图例应恢复');
await waitFor(`${view}.contentEl.querySelector('.graph-legend-container')?.getBoundingClientRect().width>0`, '标签图例应可见');
await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
command('dev:screenshot', `path=${path.join(root, '.test-results/graph.png')}`);
await evaluate(`(()=>{app.setting.open();app.setting.openTabById('extended-graph');return true;})()`);
await waitFor(`app.setting.popout?.win.document.querySelector('.extended-graph-settings')?.getBoundingClientRect().width>0`, '插件设置窗口应显示');
await evaluate(`new Promise(resolve=>app.setting.popout.win.requestAnimationFrame(()=>app.setting.popout.win.requestAnimationFrame(resolve)))`);
const settingsScreenshot = JSON.stringify(path.join(root, '.test-results/settings.png'));
await evaluate(`(async()=>{const image=await app.setting.popout.win.electronWindow.capturePage();require('fs').writeFileSync(${settingsScreenshot},image.toPNG());return true;})()`);
await evaluate(`(()=>{app.setting.close();return true;})()`);
console.log('通过：正式构建的图谱启停、标签图例、设置界面与截图验收');
