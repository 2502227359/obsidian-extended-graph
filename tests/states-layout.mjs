import assert from 'node:assert/strict';
import { openGraph } from './graph-fixture.mjs';

function assertAligned(ui, buttons) {
    const elements = [ui.stateSetting.nameEl, ui.selectState.selectEl, ...buttons.map(button => button.extraSettingsEl)];
    const bounds = elements.map(element => element.getBoundingClientRect());
    assert.ok(bounds.every(rect => rect.width > 0 && rect.height > 0), '状态控件应可见');
    const centers = bounds.map(rect => rect.top + rect.height / 2);
    assert.ok(Math.max(...centers) - Math.min(...centers) <= 1,
        `状态文字、下拉框和按钮应垂直居中，实际中心：${centers.join(', ')}`);
    const panel = ui.root.getBoundingClientRect();
    const top = Math.min(...bounds.map(rect => rect.top)) - panel.top;
    const bottom = panel.bottom - Math.max(...bounds.map(rect => rect.bottom));
    assert.ok(Math.abs(top - bottom) <= 1, `状态面板上下留白应一致，实际：${top}/${bottom}`);
    for (const button of buttons) {
        assert.equal(button.extraSettingsEl.parentElement, ui.stateSetting.controlEl, '操作按钮应始终位于控件组中');
    }
}

export async function statesLayout(plugin) {
    const graph = await openGraph(plugin);
    try {
        const ui = graph.instances.statesUI;
        if (!ui.isOpen) ui.toggleButton.extraSettingsEl.click();
        const defaultId = ui.selectState.getValue();
        assertAligned(ui, [ui.addButton]);
        ui.selectState.addOption('regression-layout', '自定义状态');
        ui.setValue('regression-layout');
        assertAligned(ui, [ui.editButton, ui.addButton, ui.saveButton, ui.deleteButton]);
        ui.setValue(defaultId);
        assertAligned(ui, [ui.addButton]);
        assert.equal(ui.stateSetting.controlEl.querySelectorAll('.extra-setting-button').length, 1);
    } finally {
        graph.leaf.detach();
    }
}
