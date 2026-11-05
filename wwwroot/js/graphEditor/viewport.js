// Editor 的視野：背景格線，以及「定位整個工作流」（fit view）。
import { GRID_SIZE } from "./shared.js";

// 背景格線：細線間距即按住 Shift 時的對齊間距，每 GRID_MAJOR_EVERY 格一條粗線；縮小到 GRID_MINOR_MIN_SCALE 以下不畫細線
const GRID_MAJOR_EVERY = 5;
const GRID_MINOR_MIN_SCALE = 0.6;
const GRID_BGCOLOR = "#191919";
const GRID_MINOR_COLOR = "#131313";
const GRID_MAJOR_COLOR = "#0c0c0c";
// 一鍵定位整個工作流時，四周（含節點上方的狀態標籤）留的邊距，以及最大放大倍率
const FIT_PADDING = 40;
const FIT_MAX_SCALE = 1.5;
const FIT_ANIMATION_MS = 350;

export class ViewportMethods {
    /** 背景格線：細線每 GRID_SIZE 一條（Shift 對齊的間距），粗線每 GRID_MAJOR_EVERY 格一條。 */
    drawGrid(ctx, [x, y, w, h]) {
        ctx.fillStyle = GRID_BGCOLOR;
        ctx.fillRect(x, y, w, h);
        const scale = this.canvas.ds.scale;
        const major = GRID_SIZE * GRID_MAJOR_EVERY;
        const lines = (step, color, width) => {
            ctx.beginPath();
            for (let gx = Math.floor(x / step) * step; gx <= x + w; gx += step) {
                ctx.moveTo(gx, y);
                ctx.lineTo(gx, y + h);
            }
            for (let gy = Math.floor(y / step) * step; gy <= y + h; gy += step) {
                ctx.moveTo(x, gy);
                ctx.lineTo(x + w, gy);
            }
            ctx.strokeStyle = color;
            // 線寬以螢幕像素計，縮放時粗細不變
            ctx.lineWidth = width / scale;
            ctx.stroke();
        };
        if (scale >= GRID_MINOR_MIN_SCALE) lines(GRID_SIZE, GRID_MINOR_COLOR, 1);
        lines(major, GRID_MAJOR_COLOR, 2);
    }

    /**
     * 視野移到整個工作流（所有節點），以動畫過渡。rightInset 是畫布右側被面板蓋住的寬度（px），
     * 工作流會置中在剩下的區域裡。
     */
    fitView(rightInset = 0) {
        const items = [...this.graph._nodes, ...this.graph._groups];
        if (!items.length) return;
        let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const n of items) {
            const [bx, by, bw, bh] = n.boundingRect;
            minX = Math.min(minX, bx);
            minY = Math.min(minY, by);
            maxX = Math.max(maxX, bx + bw);
            maxY = Math.max(maxY, by + bh);
        }
        minX -= FIT_PADDING;
        minY -= FIT_PADDING;
        maxX += FIT_PADDING;
        maxY += FIT_PADDING;

        const ds = this.canvas.ds;
        const dpr = window.devicePixelRatio;
        const cw = ds.element.width / dpr;
        const ch = ds.element.height / dpr;
        const usable = Math.max(cw - rightInset, cw * 0.3);
        const scale = Math.min(usable / (maxX - minX), ch / (maxY - minY), FIT_MAX_SCALE);
        // animateToBounds 會讓範圍置中並以 zoom × 畫布大小 ÷ 範圍 決定縮放；
        // 給它一個「縮放結果正好是 scale、中心往右偏 rightInset/2」的範圍
        const centerX = (minX + maxX) / 2 + rightInset / 2 / scale;
        const centerY = (minY + maxY) / 2;
        const width = cw / scale;
        const height = ch / scale;
        ds.animateToBounds([centerX - width / 2, centerY - height / 2, width, height],
            () => this.canvas.setDirty(true, true), { zoom: 1, duration: FIT_ANIMATION_MS });
    }
}
