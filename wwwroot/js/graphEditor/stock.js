// Editor 的暫存長條：每個插槽那一行的背景填色，表示暫存的填滿程度（C# 模擬的 Stock／Capacity）。
// 輸入從左往右填、輸出從右往左填。機器與資源節點在 onDrawBackground 呼叫 drawStockBars，
// litegraph 先畫節點本體與這個背景，再畫插槽文字，所以長條在文字後面。
//
// 顏色用藍色系，不用綠黃紅：那三種顏色是節點的狀態（運轉、減產、停擺）。
// 輸入空了、輸出滿了這類異常，節點本身已經標成紅色。

const FILL = "rgba(70, 150, 255, 0.30)";
const EDGE = "rgba(140, 200, 255, 0.9)";
const ROW_HEIGHT = 18;
// 輸入在節點的左半、輸出在右半，中間留的縫（px）
const HALF_GAP = 2;
const EDGE_WIDTH = 2;
// 填滿程度低於這個比例時不畫前緣亮線，否則幾乎是空的暫存也會看起來有東西
const MIN_EDGE_LEVEL = 0.03;
// 長條追上目標值的時間常數（秒）。模擬每 0.1 秒才更新一次、畫面每一幀都重畫，逐幀靠近目標才會平滑
const SMOOTHING_SECONDS = 0.15;

export class StockMethods {
    /** 畫出這個節點每個暫存的長條；還沒有模擬狀態（規劃有錯、模擬還沒跑）時什麼都不畫。 */
    drawStockBars(node, ctx) {
        const half = node.size[0] / 2;
        for (const row of this.stockRows(node)) {
            const [x0, x1] = row.input ? [0, half - HALF_GAP] : [half + HALF_GAP, node.size[0]];
            const width = (x1 - x0) * row.level;
            const x = row.input ? x0 : x1 - width;
            ctx.fillStyle = FILL;
            ctx.fillRect(x, row.y - ROW_HEIGHT / 2, width, ROW_HEIGHT);
            if (row.level >= MIN_EDGE_LEVEL) {
                ctx.fillStyle = EDGE;
                ctx.fillRect(row.input ? x + width - EDGE_WIDTH : x, row.y - ROW_HEIGHT / 2, EDGE_WIDTH, ROW_HEIGHT);
            }
        }
    }

    /**
     * 這個節點要畫長條的插槽：每種物品的第一個輸入（合流插槽疊在原插槽上，不重複畫）、
     * 有接線的輸出（沒接線的輸出直接進倉庫，存量永遠是 0）。y 是插槽在節點內的垂直位置。
     */
    stockRows(node) {
        const state = this.nodeStates.get(String(node.id));
        if (!state || node.flags.collapsed) return [];

        const rows = [];
        const seen = new Set();
        node.inputs.forEach((slot, i) => {
            if (seen.has(slot.type)) return;
            seen.add(slot.type);
            const s = state.inputs.find(x => x.productId === slot.type);
            if (s?.capacity > 0) rows.push({ input: true, y: node.getInputPos(i)[1] - node.pos[1], slot: s, key: `in|${slot.type}` });
        });
        node.outputs.forEach((slot, i) => {
            if (!slot.links?.length) return;
            const s = state.outputs.find(x => x.productId === slot.type);
            if (s?.capacity > 0) rows.push({ input: false, y: node.getOutputPos(i)[1] - node.pos[1], slot: s, key: `out|${slot.type}` });
        });
        return rows.map(r => ({ ...r, level: this.smoothStockLevel(node, r.key, Math.min(1, r.slot.stock / r.slot.capacity)) }));
    }

    /** 追著目標值平滑移動的填滿程度（0～1）。記在節點上，節點刪除時一起釋放；第一次看到時直接等於目標。 */
    smoothStockLevel(node, key, target) {
        const levels = (node.stockLevels ??= new Map());
        const now = performance.now();
        const entry = levels.get(key);
        if (!entry) {
            levels.set(key, { value: target, time: now });
            return target;
        }
        entry.value += (target - entry.value) * (1 - Math.exp(-(now - entry.time) / 1000 / SMOOTHING_SECONDS));
        entry.time = now;
        return entry.value;
    }
}
