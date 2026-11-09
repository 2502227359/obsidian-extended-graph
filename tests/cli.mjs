import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { vault } from './setup.mjs';

export function command(...args) {
    const output = execFileSync(process.env.OBSIDIAN_CLI ?? 'obsidian', ['vault=.test-vault', ...args], {
        encoding: 'utf8', timeout: 60000, windowsHide: true,
    });
    if (/^Error:/m.test(output)) throw new Error(output.trim());
    return output;
}

export async function evaluate(code) {
    const output = command('eval', `code=(async()=> 'EG_JSON:'+JSON.stringify((await (${code})) ?? null))()`);
    const match = output.match(/EG_JSON:([^\r\n]+)/);
    if (!match) throw new Error(`未收到 Obsidian 执行结果：${output}`);
    return JSON.parse(match[1]);
}

export function assertTestVault() {
    const actual = command('vault', 'info=path').trim();
    assert.equal(path.resolve(actual), path.resolve(vault), 'CLI 必须指向当前项目的独立测试库');
}
