import { Notice, PluginSettingTab, Setting, ToggleComponent } from "obsidian";
import {
    ConfirmModal,
    ExportConfigModal,
    ImportConfigModal,
    ExtendedGraphInstances,
    SettingFocus,
    SettingFolders,
    SettingImages,
    SettingLinks,
    SettingElementsStats,
    SettingPerformance,
    SettingPropertiesArray,
    SettingShapes,
    SettingsSection,
    SettingTags,
    SettingZoom,
    SettingNames,
    SettingIcons,
    SettingArrows,
    ExtendedGraphSettings,
    SettingQuery,
    SettingAutomation,
    SettingDisplay,
    SettingBeta,
    SettingFilter,
    t,
    SettingInput as SettingInputs,
    SettingLayers,
    validateFilename,
    SettingLocal as SettingLocalGraph
} from "../internal";
import ExtendedGraphPlugin from "../main";

/** Section id → group heading key; sections sharing a key render under one header. */
const SECTION_GROUPS: Record<string, string> = {
    tags: "settings.groupNodeEnhancement",
    properties: "settings.groupNodeEnhancement",
    links: "settings.groupNodeEnhancement",
    folders: "settings.groupNodeEnhancement",
    images: "settings.groupNodeEnhancement",
    icons: "settings.groupNodeEnhancement",
    shapes: "settings.groupNodeEnhancement",
    arrows: "settings.groupVisual",
    layers: "settings.groupVisual",
    "elements-stats": "settings.groupVisual",
    names: "settings.groupVisual",
    focus: "settings.groupInteraction",
    zoom: "settings.groupInteraction",
    inputs: "settings.groupInteraction",
    display: "settings.groupGlobal",
    filter: "settings.groupGlobal",
    "local-graph": "settings.groupGlobal",
    automation: "settings.groupGlobal",
    performances: "settings.groupAdvanced",
    beta: "settings.groupAdvanced",
};

export class ExtendedGraphSettingTab extends PluginSettingTab {
    sections: SettingsSection[] = [];
    originalSettings: ExtendedGraphSettings;
    showResetModalToggle: ToggleComponent;

    settingsWithPalettes: { onCustomPaletteModified: (oldName: string, newName: string) => void }[] = [];

    constructor(plugin: ExtendedGraphPlugin) {
        super(ExtendedGraphInstances.app, plugin);

        // We need to store those ones localy in order to interact with them
        // when a custom color palette is created/edited/deleted
        const settingsTags = new SettingTags(this);
        const settingsProperties = new SettingPropertiesArray(this);
        const settingLinks = new SettingLinks(this);
        const settingFolders = new SettingFolders(this);
        const settingElementsStats = new SettingElementsStats(this);
        const settingLocalGraph = new SettingLocalGraph(this);
        this.settingsWithPalettes.push(
            settingsTags,
            settingsProperties,
            settingLinks,
            settingFolders,
            settingElementsStats,
            settingLocalGraph
        )

        // Render order = grouping in the tab (see SECTION_GROUPS): node
        // enhancements first, then visual, interaction, global, advanced.
        this.sections.push(settingsTags);
        this.sections.push(settingsProperties);
        this.sections.push(settingLinks);
        this.sections.push(settingFolders);
        this.sections.push(new SettingImages(this));
        this.sections.push(new SettingIcons(this));
        this.sections.push(new SettingShapes(this));
        this.sections.push(new SettingArrows(this));
        this.sections.push(new SettingLayers(this));
        this.sections.push(settingElementsStats);
        this.sections.push(new SettingNames(this));
        this.sections.push(new SettingFocus(this));
        this.sections.push(new SettingZoom(this));
        this.sections.push(new SettingInputs(this));
        this.sections.push(new SettingDisplay(this));
        this.sections.push(new SettingFilter(this));
        this.sections.push(settingLocalGraph);
        this.sections.push(new SettingAutomation(this));
        this.sections.push(new SettingPerformance(this));
        this.sections.push(new SettingBeta(this));
    }

    override display(): void {
        this.originalSettings = structuredClone(ExtendedGraphInstances.settings);
        this.containerEl.empty();
        this.containerEl.addClass("extended-graph-settings");

        this.addImportExport();
        this.addNav();

        // FEATURES, with non-collapsible group headers between them
        let lastGroup = "";
        for (const section of this.sections) {
            const group = SECTION_GROUPS[section.id];
            if (group && group !== lastGroup) {
                this.containerEl.createDiv({ cls: "settings-group-header", text: t(group) });
            }
            lastGroup = group;
            section.display();
        }
    }

    private addImportExport(): void {
        new Setting(this.containerEl)
            .addExtraButton(cb => {
                cb.extraSettingsEl.insertAdjacentText('beforebegin', t("controls.export"))
                cb.setIcon("upload");
                cb.setTooltip(t("controls.exportSettings"));
                cb.onClick(() => {
                    const modal = new ExportConfigModal((name: string, fullpath: boolean) => {
                        const filepath = fullpath ? name : ExtendedGraphInstances.configurationDirectory + "/" + name + ".json";
                        if (!fullpath) {
                            if (!validateFilename(name)) {
                                return false;
                            }
                        }
                        ExtendedGraphInstances.plugin.exportSettings(filepath, ExtendedGraphInstances.settings);
                        return true;
                    });
                    modal.open();
                });
            })
            .addExtraButton(cb => {
                cb.extraSettingsEl.insertAdjacentText('beforebegin', t("controls.import"))
                cb.setIcon("download");
                cb.setTooltip(t("controls.importSettings"));
                cb.onClick(() => {
                    const modal = new ImportConfigModal((filepath: string) => {
                        if (filepath.trim() === "") {
                            new Notice(t("controls.configNameEmpty"));
                            return;
                        }
                        new ConfirmModal(
                            t("controls.importSettings"),
                            t("notices.importConfirmBody"),
                            (confirmed: boolean) => {
                                if (!confirmed) return;
                                ExtendedGraphInstances.plugin.importSettings(filepath).then(() => {
                                    new Notice(t("notices.settingsImported"));
                                    this.display();
                                });
                            },
                            true
                        ).open();
                    });
                    modal.open();
                });
            });
    }

    private addNav(): void {
        const nav = this.containerEl.createDiv({ cls: "extended-graph-nav-settings" });

        const label = nav.createDiv({ cls: "nav-label" });
        label.innerText = t("controls.goTo");
    }

    override hide(): void {
        if (ExtendedGraphInstances.graphsManager && ExtendedGraphInstances.settings.resetAfterChanges) {
            if (SettingQuery.needReload(this.originalSettings, ExtendedGraphInstances.settings, 'graph')) {
                ExtendedGraphInstances.graphsManager.lifecycleManager.resetAllPlugins('graph');
            }
            if (SettingQuery.needReload(this.originalSettings, ExtendedGraphInstances.settings, 'localgraph')) {
                ExtendedGraphInstances.graphsManager.lifecycleManager.resetAllPlugins('localgraph');
            }
        }
        super.hide();
    }

    onCustomPaletteModified(oldName: string, newName: string): void {
        for (const setting of this.settingsWithPalettes) {
            setting.onCustomPaletteModified(oldName, newName);
        }
        ExtendedGraphInstances.plugin.saveSettings();
    }
}