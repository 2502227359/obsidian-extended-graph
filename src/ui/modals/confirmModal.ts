import { Modal, Setting } from "obsidian";
import { ExtendedGraphInstances, t } from "../../internal";

export class ConfirmModal extends Modal {
    bodyText: string;
    callback: (confirmed: boolean) => void;
    private resolved: boolean = false;

    constructor(title: string, body: string, callback: (confirmed: boolean) => void) {
        super(ExtendedGraphInstances.app);
        this.setTitle(title);
        this.modalEl.addClass("graph-modal-confirm");
        this.bodyText = body;
        this.callback = callback;
    }

    onOpen() {
        this.contentEl.createEl("p", { text: this.bodyText });
        new Setting(this.contentEl)
            .addButton(cb => {
                cb.setButtonText(t("controls.cancel"));
                cb.onClick(() => {
                    this.close();
                });
            })
            .addButton(cb => {
                cb.setButtonText(t("controls.confirm"));
                cb.setCta();
                cb.onClick(() => {
                    this.resolved = true;
                    this.callback(true);
                    this.close();
                });
            });
    }

    onClose(): void {
        if (!this.resolved) this.callback(false);
        this.contentEl.empty();
    }
}
