import assert from 'node:assert/strict';
import chroma from 'chroma-js';
import { polishFixture, cleanPolish } from './relations-polish.mjs';
import { waitFor } from './graph-fixture.mjs';

export async function appearanceFixture(plugin) {
    const fixture = await polishFixture(plugin), { app, files } = fixture;
    for (const folder of ['one', 'two']) {
        const root = 'relations-polish/' + folder;
        if (!app.vault.getAbstractFileByPath(root)) await app.vault.createFolder(root);
        files.push(await app.vault.create(root + '/1.10.4 内脏活动调节-中枢调节与本能行为.md', '# 调节\n'));
    }
    await app.vault.modify(files[1], '# 1.1 常用药物\n# 2.2 常用药物\n' + files.slice(2).map(file => `[[${file.path}]]`).join('\n'));
    await waitFor(() => files.slice(2).every(file => app.metadataCache.resolvedLinks[files[1].path]?.[file.path]), '外观样本应有两个同名临时节点');
    return fixture;
}

export async function showAppearance(fixture) {
    const { leaf, files } = fixture;
    const toggle = leaf.view.contentEl.querySelector('.eg-hover-branches-toggle');
    if (toggle.getAttribute('aria-pressed') !== 'true') toggle.click();
    const mini = leaf.view.contentEl.querySelector('.eg-branch-preview');
    leaf.view.renderer.onNodeHover(new MouseEvent('mousemove', { clientX: 500, clientY: 330 }), files[1].path, '');
    mini.dispatchEvent(new PointerEvent('pointerenter'));
    await waitFor(() => !mini.hidden && leaf.view.renderer.hanger.children.find(c => c.name === 'eg-branch-layer')?.alpha > 0.9, '临时图层应可见');
    return mini;
}

export async function graphThemeLabels(plugin) {
    const fixture = await appearanceFixture(plugin), { app, leaf } = fixture;
    const theme = { dark: document.body.classList.contains('theme-dark'), light: document.body.classList.contains('theme-light') };
    try {
        const mini = await showAppearance(fixture);
        for (const light of [true, false]) {
            document.body.classList.toggle('theme-light', light);
            document.body.classList.toggle('theme-dark', !light);
            app.workspace.trigger('css-change');
            const expected = chroma(getComputedStyle(leaf.view.contentEl).getPropertyValue('--text-normal').trim()).hex();
            await waitFor(() => {
                const layer = leaf.view.renderer.hanger.children.find(c => c.name === 'eg-branch-layer');
                const labels = layer?.children.flatMap(g => g.children.filter(c => c.text)) ?? [];
                return labels.length === 2 && labels.every(label => chroma(label.style.fill).hex() === expected);
            }, '临时节点文字应在主题变化后保持可读');
        }
        const names = [...mini.querySelectorAll('g[data-path]')].filter(g => g.dataset.path.includes('内脏活动')).map(g => g.querySelector('text').textContent);
        assert.equal(new Set(names).size, 2, '同名节点应能通过目录区分');
        assert.ok(names.every(name => name.includes('内脏活动')), '短名称应优先保留意义，而非仅保留编号');
        assertPointerTitle(fixture);
    } finally {
        document.body.classList.toggle('theme-dark', theme.dark);
        document.body.classList.toggle('theme-light', theme.light);
        app.workspace.trigger('css-change');
        await cleanPolish(fixture);
    }
}

function assertPointerTitle({ leaf, files }) {
    const renderer = leaf.view.renderer, canvas = renderer.interactiveEl;
    const before = canvas.getAttribute('title');
    const layer = renderer.hanger.children.find(c => c.name === 'eg-branch-layer');
    const ghost = layer.children.find(c => c.name === 'eg-branch-node:' + files[2].path);
    const point = ghost.getGlobalPosition(), bounds = canvas.getBoundingClientRect(), screen = renderer.px.renderer.screen;
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: bounds.left + point.x * bounds.width / screen.width, clientY: bounds.top + point.y * bounds.height / screen.height, bubbles: true }));
    assert.equal(canvas.title, files[2].path, '主图临时节点也应提供完整路径提示');
    leaf.view.contentEl.querySelector('.eg-hover-branches-toggle').click();
    assert.equal(canvas.getAttribute('title'), before, '关闭临时预览后应恢复画布提示');
}

export async function graphPanelLayout(plugin) {
    const fixture = await appearanceFixture(plugin), { app, leaf, files, inputs } = fixture;
    const before = leaf.view.contentEl.getAttribute('style');
    try {
        const titles = Array.from({ length: 24 }, (_, i) => `复盘关联位置 ${i + 1}`);
        await app.vault.modify(files[1], titles.map(title => '# ' + title).join('\n') + '\n' + files.slice(2).map(file => `[[${file.path}]]`).join('\n'));
        await app.vault.modify(files[0], '# 中心\n' + titles.map(title => `[[Target#${title}]]`).join('\n'));
        await waitFor(() => app.metadataCache.getFileCache(files[1])?.headings?.length === 24 && app.metadataCache.getFileCache(files[0])?.links?.length === 24, '长列表样本应完成解析');
        inputs.showRelations(files[1].path);
        await waitFor(() => leaf.view.contentEl.querySelectorAll('.eg-relations-group').length === 24, '长列表应出现');
        for (const width of [360, 420, 800]) {
            leaf.view.contentEl.style.width = width + 'px';
            await new Promise(resolve => setTimeout(resolve, 120));
            const mini = await showAppearance(fixture);
            const panel = leaf.view.contentEl.querySelector('.eg-relations-panel');
            await new Promise(resolve => setTimeout(resolve, 80));
            assertPanels(leaf, mini, panel, width);
        }
    } finally {
        if (before === null) leaf.view.contentEl.removeAttribute('style');
        else leaf.view.contentEl.setAttribute('style', before);
        await cleanPolish(fixture);
    }
}

function assertPanels(leaf, mini, panel, width) {
    const area = leaf.view.contentEl.getBoundingClientRect(), a = mini.getBoundingClientRect(), b = panel.getBoundingClientRect();
    const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    assert.ok(x * y < 1, `${width} 像素视图中小图不能盖住关联列表`);
    assert.ok(a.left >= area.left && a.right <= area.right + 1 && b.right <= area.right + 1, '两个面板均应留在当前视图');
    assert.ok(panel.scrollWidth <= panel.clientWidth + 1, '窄窗不能产生横向溢出');
    const pair = panel.querySelector('.eg-relations-pair'), top = pair.getBoundingClientRect().top;
    const body = panel.querySelector('.eg-relations-body');
    body.scrollTop = body.scrollHeight;
    assert.ok(Math.abs(pair.getBoundingClientRect().top - top) < 1, '滚动列表时文件对及关闭入口应保持稳定');
    body.scrollTop = 0;
}
