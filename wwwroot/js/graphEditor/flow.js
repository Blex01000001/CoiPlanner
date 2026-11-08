// Editor 的連線外觀：依運輸等級的線寬、沿連線移動的箭頭、連線中點的流量標籤。
import { LiteGraph, LGraphCanvas } from "../../lib/litegraph/litegraph.es.js";
import { FLOW_LABEL_BGCOLOR, formatRate, round1 } from "./shared.js";

// 連線粗細依運輸等級的吞吐量：每加倍粗 LINK_WIDTH_PER_DOUBLING（60/分 為 LINK_BASE_WIDTH）
const LINK_BASE_WIDTH = 3;
const LINK_BASE_CAPACITY = 60;
const LINK_WIDTH_PER_DOUBLING = 1.5;
// 流量動畫：箭頭沿連線方向移動，間距、速度與大小以畫布座標（px）計；
// 滿載時速度為 FLOW_ARROW_SPEED，有流量但很少時至少有 FLOW_ARROW_MIN_RATIO 的速度，沒有流量時不動並變淡
const FLOW_ARROW_SPACING = 40;
const FLOW_ARROW_SPEED = 60;
const FLOW_ARROW_MIN_RATIO = 0.25;
const FLOW_ARROW_IDLE_ALPHA = 0.3;
const FLOW_ARROW_SIZE = 5;
// 連線中點的流量標籤；達到運輸上限時改用醒目的顏色與粗體
const FLOW_LABEL_FONT = "12px Arial";
const FLOW_LABEL_FULL_FONT = "bold 13px Arial";
const FLOW_LABEL_COLOR = "#ddd";
const FLOW_LABEL_FULL_COLOR = "#ff6b6b";

export class FlowMethods {
    /** 在每條連線上畫出沿方向移動的箭頭，速度隨模擬的流量改變；沒有流量的連線箭頭不動並變淡。 */
    drawFlow(ctx) {
        const now = performance.now();
        const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
        this.lastFrame = now;
        // 箭頭畫在節點上層；落在節點範圍內（連線從節點後面繞過時）的箭頭不畫，看起來才像被節點蓋住
        const titleHeight = LiteGraph.NODE_TITLE_HEIGHT;
        const boxes = this.graph._nodes.map(n => [n.pos[0], n.pos[1] - titleHeight, n.size[0], n.size[1] + titleHeight]);
        const hidden = (x, y) => boxes.some(([bx, by, bw, bh]) => x > bx && x < bx + bw && y > by && y < by + bh);
        for (const link of this.graph._links.values()) {
            const origin = this.graph.getNodeById(link.origin_id);
            const target = this.graph.getNodeById(link.target_id);
            if (!origin || !target) continue;

            const a = origin.getConnectionPos(false, link.origin_slot);
            const b = target.getConnectionPos(true, link.target_slot);
            // 以控制點的折線長度估算曲線長度，決定要畫幾個箭頭
            const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.2;
            if (length < 1) continue;

            const r = this.edgeResults.get(link.id);
            const ratio = r && r.flowPerMinute > 1e-6 ? Math.min(1, r.flowPerMinute / r.capacityPerMinute) : 0;
            const speed = ratio > 0 ? FLOW_ARROW_SPEED * Math.max(FLOW_ARROW_MIN_RATIO, ratio) : 0;
            const offset = ((this.linkPhases.get(link.id) ?? 0) + speed * dt) % FLOW_ARROW_SPACING;
            this.linkPhases.set(link.id, offset);

            ctx.fillStyle = link.color ?? LGraphCanvas.link_type_colors[link.type] ?? this.canvas.default_link_color;
            ctx.globalAlpha = ratio > 0 ? 1 : FLOW_ARROW_IDLE_ALPHA;
            for (let d = offset; d < length; d += FLOW_ARROW_SPACING) {
                const t = d / length;
                const [x, y] = this.canvas.computeConnectionPoint(a, b, t);
                if (hidden(x, y)) continue;
                // 箭頭方向取曲線在這一點附近的切線
                const [nx, ny] = this.canvas.computeConnectionPoint(a, b, Math.min(t + 0.01, 1));
                const [px, py] = this.canvas.computeConnectionPoint(a, b, Math.max(t - 0.01, 0));
                const angle = Math.atan2(ny - py, nx - px);
                // 箭頭和連線同色，線越粗箭頭也要越大才看得到
                const s = Math.max(FLOW_ARROW_SIZE, this.linkWidth(link) * 0.6 + 2);
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(angle);
                ctx.beginPath();
                ctx.moveTo(s * 1.4, 0);
                ctx.lineTo(-s, -s);
                ctx.lineTo(-s * 0.4, 0);
                ctx.lineTo(-s, s);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
            ctx.globalAlpha = 1;

            this.drawFlowLabel(ctx, link, a, b, hidden);
        }
        this.drawStatus(ctx);
    }

    /** 在連線中點畫「流量/上限」；達到上限時用醒目的顏色與粗體。 */
    drawFlowLabel(ctx, link, a, b, hidden) {
        const r = this.edgeResults.get(link.id);
        if (!r) return;
        const [x, y] = this.canvas.computeConnectionPoint(a, b, 0.5);
        if (hidden(x, y)) return;

        const full = r.isFull;
        const text = `${formatRate(round1(r.flowPerMinute))}/${formatRate(r.capacityPerMinute)}`;
        ctx.font = full ? FLOW_LABEL_FULL_FONT : FLOW_LABEL_FONT;
        const w = ctx.measureText(text).width + 10;
        const h = 18;
        ctx.fillStyle = FLOW_LABEL_BGCOLOR;
        ctx.strokeStyle = full ? FLOW_LABEL_FULL_COLOR : link.color ?? LGraphCanvas.link_type_colors[link.type] ?? this.canvas.default_link_color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - h / 2, w, h, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = full ? FLOW_LABEL_FULL_COLOR : FLOW_LABEL_COLOR;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, x, y + 1);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
    }

    /** 連線的線寬：運輸等級的吞吐量每加倍就粗一些；等級有誤時用基本線寬。 */
    linkWidth(link) {
        const capacity = this.transportFor(link.type)?.tiersPerMinute[(this.linkTiers.get(link.id) ?? 1) - 1];
        if (!capacity) return LINK_BASE_WIDTH;
        return LINK_BASE_WIDTH + LINK_WIDTH_PER_DOUBLING * Math.log2(Math.max(1, capacity / LINK_BASE_CAPACITY));
    }
}
