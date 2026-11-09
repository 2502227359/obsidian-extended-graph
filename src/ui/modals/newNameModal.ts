import { Modal, Setting, TextComponent } from "obsidian";
import { ExtendedGraphInstances, UIElements, t } from "../../internal";

export class NewNameModal extends Modal {
    callback: (name: string) => boolean;
    input: TextComponent;
    name?: string;
    private errorEl: HTMLElement;

    constructor(title: string, callback: (name: string) => boolean, name?: string) {
        super(ExtendedGraphInstances.app);
        this.setTitle(title);
        this.modalEl.addClass("graph-modal-new");
        this.callback = callback;
        this.name = name;

        this.scope.register(null, "Enter", (e: KeyboardEvent) => {
            this.submit();
        });
    }

    onOpen() {
        new Setting(this.contentEl)
            .addText((text) => {
                this.input = text;
                if (this.name) {
                    this.input.setValue(this.name);
                }
                this.input.onChange(() => this.errorEl.setText(""));
            })
            .addButton((cb) => {
                UIElements.setupButton(cb, this.name ? 'edit' : 'add');
                cb.buttonEl.addEventListener('click', e => {
                    this.submit();
                })
            });
        this.errorEl = this.contentEl.createDiv({ cls: "error" });
        this.input.inputEl.focus();
    }

    private submit(): void {
        if (this.callback(this.input.getValue())) {
            this.close();
        }
        else {
            this.errorEl.setText(t("errors.nameInvalid"));
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}