import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setup, root } from './setup.mjs';
import { command, assertTestVault } from './cli.mjs';

await setup();
assertTestVault();
command('plugin:reload', 'id=extended-graph');
const names = process.argv.slice(2);
if (names.length === 0) {
    const output = command('eval', "code='EG_TEST_CASES:'+JSON.stringify(app.plugins.plugins['extended-graph'].getRegressionNames())");
    const list = output.match(/EG_TEST_CASES:(\[[^\r\n]+\])/);
    if (!list) throw new Error(`无法读取测试列表：${output}`);
    names.push(...JSON.parse(list[1]));
}
const results = [];
for (const name of names) {
    const code = `app.plugins.plugins['extended-graph'].runRegression(${JSON.stringify(name)}).then(r=>'EG_TEST_RESULT:'+JSON.stringify(r))`;
    const output = command('eval', `code=${code}`);
    const resultLine = output.match(/EG_TEST_RESULT:(\{[^\r\n]+\})/);
    if (!resultLine) throw new Error(`测试未返回结果：${output}`);
    const result = JSON.parse(resultLine[1]);
    results.push(result);
    console.log(`${result.passed ? '通过' : '失败'}：${name}`);
    if (!result.passed) console.error(result.error);
}
await mkdir(path.join(root, '.test-results'), { recursive: true });
await writeFile(path.join(root, '.test-results/regressions.json'), JSON.stringify(results, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
