import { ExportGraphToSVG } from '../src/svg/exportToSVG.ts';

function rectangle(x, y) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for (const [key, value] of Object.entries({ x, y, width: 10, height: 10 })) {
        element.setAttribute(key, String(value));
    }
    return element;
}

// 具体导出器只提供几何测试数据，边界计算和 SVG 组装均使用正式实现。
export class SVGFixture extends ExportGraphToSVG {
    getVisibleLinks() { return [null]; }
    getVisibleNodes() { return [null]; }
    getSVGForLink() { return rectangle(0, 0); }
    getSVGForNode() { return rectangle(100, 100); }
    render() {
        this.options = { showFolders: false, showNodeNames: false };
        this.createSVG();
        return this.svg;
    }
}
