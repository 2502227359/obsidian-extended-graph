import { App, FuzzySuggestModal, TFile } from "obsidian";

/** 从当前局部图谱提供的文件节点中选择目标。 */
export class GraphNodeModal extends FuzzySuggestModal<TFile> {
    constructor(app: App, private files: TFile[], private choose: (file: TFile) => void) {
        super(app);
        this.setPlaceholder("选择当前局部图谱中的节点");
        this.modalEl.addClass("eg-local-node-picker");
    }

    getItems(): TFile[] { return this.files; }
    getItemText(file: TFile): string { return file.path; }
    onChooseItem(file: TFile): void { this.choose(file); }
}
