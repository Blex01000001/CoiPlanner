// 物品顏色：連線、插槽與節點依物品上色。顏色來自 Data/game.json 物品的 color 欄位，沒有的物品用 FALLBACK_COLOR。
// 節點取「主要產出物」（沒有輸出時取第一個輸入）的顏色，標題與底色由它調暗而來。
import { LGraphCanvas } from "../../lib/litegraph/litegraph.es.js";

const FALLBACK_COLOR = "#9aa0a6";
// 物品 id → 顏色，由 setProductColors 依目錄填入
const productColors = new Map();

// 節點標題／底色與物品色混合時，物品色所佔的比例（底色要淡：暫存長條是淡藍色，底色太藍會和它混淆）
const TITLE_MIX = 0.55;
const BODY_MIX = 0.08;
const NODE_BASE = [30, 30, 30];

export function setProductColors(products) {
    productColors.clear();
    for (const p of products) if (p.color) productColors.set(p.productId, p.color);
}

export function productColor(productId) {
    return productColors.get(productId) ?? FALLBACK_COLOR;
}

/** 節點的標題色與底色（物品色調暗）。 */
export function nodeColors(productId) {
    const rgb = parse(productColor(productId));
    return { color: mix(rgb, TITLE_MIX), bgcolor: mix(rgb, BODY_MIX) };
}

/** 節點的主要物品：資源取其物品，機器取第一個輸出，沒有輸出取第一個輸入。 */
export function primaryProductId(node) {
    if (node.properties?.kind === "source") return node.properties.productId;
    return node.slotInfo?.outputs[0]?.productId ?? node.slotInfo?.inputs[0]?.productId;
}

/** 連線與插槽依物品上色（litegraph 以連線／插槽的類型，也就是物品 id 查顏色）。 */
export function registerProductColors(canvas, productIds) {
    for (const id of productIds) {
        const c = productColor(id);
        LGraphCanvas.link_type_colors[id] = c;
        canvas.default_connection_color_byType[id] = c;
        canvas.default_connection_color_byTypeOff[id] = c;
    }
}

function parse(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(rgb, ratio) {
    const c = rgb.map((v, i) => Math.round(NODE_BASE[i] * (1 - ratio) + v * ratio));
    return `#${c.map(v => v.toString(16).padStart(2, "0")).join("")}`;
}
