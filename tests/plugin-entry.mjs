import ExtendedGraphPlugin from '../src/main.ts';
import { caseNames, runRegression } from './regressions.mjs';

// 测试入口独立打包；正式构建仍从 src/main.ts 开始，不包含测试接口。
export default class TestPlugin extends ExtendedGraphPlugin {
    getRegressionNames() {
        return caseNames;
    }

    async runRegression(name) {
        try {
            await runRegression(name, this);
            return { name, passed: true };
        } catch (error) {
            return { name, passed: false, error: error.stack ?? String(error) };
        }
    }
}
