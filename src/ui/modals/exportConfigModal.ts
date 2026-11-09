import { DropdownComponent, Modal, Setting, TextComponent } from "obsidian";
import { getAllConfigFiles, ExtendedGraphInstances, t, pathParse } from "../../internal";

export class ExportConfigModal extends Modal {
    callback: (name: string, fullpath: boolean) => boolean;
    input: TextComponent;
    dropdown: DropdownComponent;
    name?: string;

    constructor(callback: (name: string, fullpath: boolean) => boolean) {
        super(ExtendedGraphInstances.app);
        this.setTitle(t("controls.setConfigName"));
        this.modalEl.addClass("graph-modal-export-config");
        this.callback = callback;

        this.scope.register(null, "Enter", (e: KeyboardEvent) => {
            this.validate(this.input.getValue());
        });
    }

    onOpen() {
        new Setting(this.contentEl)
            .setName(t("controls.overrideConfig"))
            .addDropdown(async (cb) => {
                this.dropdown = cb;
                cb.addOption("", "");
                const files = await getAllConfigFiles();
                cb.addOptions(Object.fromEntries(files.map(file => [
                    file,
                    pathParse(file, ".json").basename + (ExtendedGraphInstances.statesManager.getStateFromConfig(file) ? t("controls.linkedState") : "")
                ])));
            })
            .addButton((cb) => {
                cb.setIcon("upload");
                cb.setCta();
                cb.onClick(() => {
                    // The dropdown is filled asynchronously: ignore clicks while
                    // nothing is selected (empty value) instead of exporting to ""
                    const name = this.dropdown.getValue();
                    if (name === "") return;
                    if (this.callback(name, true)) {
                        this.close();
                    }
                });
            });

        new Setting(this.contentEl)
            .setName(t("controls.orCreateConfig"))
            .addText((text) => {
                this.input = text;
            })
            .addButton((cb) => {
                cb.setIcon("upload");
                cb.setCta();
                cb.onClick(() => {
                    this.validate(this.input.getValue());
                })
            });
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private validate(value: string) {
        if (this.callback(value, false)) {
            this.close();
        }
    }
}