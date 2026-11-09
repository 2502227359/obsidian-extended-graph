import { ButtonComponent, ExtraButtonComponent, Modal, SearchComponent, TextComponent } from "obsidian";
import { isPropertyKeyValid, ExtendedGraphInstances, PropertiesSuggester, t, UIElements } from "../../internal";

export class SettingMultiPropertiesModal extends Modal {
    inputs: TextComponent[] = [];
    propertiesDiv: HTMLDivElement;
    properties: string[];
    addText: string;

    constructor(title: string, addText: string, properties: string[]) {
        super(ExtendedGraphInstances.app);
        this.properties = properties;
        this.addText = addText;
        this.setTitle(title);
        this.modalEl.addClass("graph-modal-setting-properties");
    }

    onOpen() {
        this.addAddButton();
        this.loadProperties();
    }

    private addAddButton() {
        this.contentEl.createSpan().textContent = this.addText;

        const addButton = new ButtonComponent(this.contentEl)
            .onClick(() => {
                this.addProperty("");
            })
        UIElements.setupButton(addButton, 'add');
    }

    private loadProperties() {
        this.propertiesDiv = this.contentEl.createDiv("properties-list");
        for (const property of this.properties) {
            this.addProperty(property);
        }
    }

    private addProperty(property: string) {
        const inputDiv = this.propertiesDiv.createDiv("property-value");

        const input = new SearchComponent(inputDiv)
            .setValue(property)
            .onChange(key => {
                const index = this.indexOfRow(inputDiv);
                if (index < 0 || index >= this.properties.length) return;
                if (key === this.properties[index]) {
                    errorEl.setText("");
                    return;
                }
                if (this.renamePropertyAt(index, key)) {
                    errorEl.setText("");
                }
                else {
                    errorEl.setText(isPropertyKeyValid(key) ? t("features.interactives.propertyAlreadyExists") : t("notices.invalidCharacter"));
                }
            });
        new PropertiesSuggester(input.inputEl, (key) => {
            this.renamePropertyAt(this.indexOfRow(inputDiv), key);
        });
        this.inputs.push(input);
        const errorEl = inputDiv.createSpan({ cls: "error" });

        // Leaving the field restores the persisted value, so the UI never
        // shows a name that failed to apply.
        input.inputEl.addEventListener("blur", () => {
            const index = this.indexOfRow(inputDiv);
            if (index >= 0 && index < this.properties.length) {
                input.setValue(this.properties[index]);
            }
            errorEl.setText("");
        });

        const deleteButton = new ExtraButtonComponent(inputDiv)
            .onClick(() => {
                this.deleteProperty(inputDiv, input);
            });
        UIElements.setupExtraButton(deleteButton, 'delete');
    }

    /** The row's DOM position is its index in the properties array (deletions splice in place). */
    private indexOfRow(inputDiv: HTMLElement): number {
        return Array.from(this.propertiesDiv.children).indexOf(inputDiv);
    }

    private deleteProperty(inputDiv: HTMLElement, input: SearchComponent) {
        const index = this.indexOfRow(inputDiv);
        if (index >= 0 && index < this.properties.length) {
            this.properties.splice(index, 1);
        }
        this.inputs.remove(input);
        inputDiv.remove();
        ExtendedGraphInstances.plugin.saveSettings();
    }

    private renamePropertyAt(index: number, newKey: string): boolean {
        if (index < 0 || index >= this.properties.length) return false;
        const oldKey = this.properties[index];
        if (isPropertyKeyValid(newKey) && !this.properties.contains(newKey) && newKey !== oldKey) {
            // Replace in place: renaming must not reorder the list nor touch a sibling duplicate
            this.properties[index] = newKey;
            ExtendedGraphInstances.plugin.saveSettings();
            return true;
        }
        return false;
    }

    onClose(): void {
        this.contentEl.empty();
    }
}