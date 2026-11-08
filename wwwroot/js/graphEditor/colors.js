// 物品顏色：連線、插槽與節點依物品上色。顏色表依物品 id，沒列到的物品用 FALLBACK_COLOR。
// 節點取「主要產出物」（沒有輸出時取第一個輸入）的顏色，標題與底色由它調暗而來。
import { LGraphCanvas } from "../../lib/litegraph/litegraph.es.js";

const FALLBACK_COLOR = "#9aa0a6";
const PRODUCT_COLORS = {
    water: "#4fc3f7",            // 水藍
    steam_high: "#e6eaec",       // 灰白
    sour_water: "#7cb342",       // 橄欖綠
    exhaust: "#8a8f94",          // 煙灰
    carbon_dioxide: "#b39ddb",   // 淡紫
    oxygen: "#80deea",           // 青
    nitrogen: "#7986cb",         // 靛藍
    coal: "#7a7570",             // 深灰褐
    iron_ore: "#b5651d",         // 鐵鏽褐
    crushed_iron_ore: "#d08a4e", // 淺鏽褐
    lime: "#e8e4c9",             // 米白
    slag: "#8e6e53",             // 灰褐
    cement: "#bdb7a8",           // 水泥灰
    molten_iron: "#ff7043",      // 橘紅
    molten_steel: "#ffb300",     // 琥珀
    iron_plate: "#bcaaa4",       // 灰粉褐
    steel_plate: "#6fa8b5",      // 鋼青
    mechanical_parts: "#c5b358", // 黃銅
    crude_oil: "#8b5e3c",
    heavy_oil: "#a0522d",
    medium_oil: "#cd853f",
    light_oil: "#e0b25a",
    diesel: "#c9a227",
    naphtha: "#f0a868",
    fuel_gas: "#f4e04d",
};

// 節點標題／底色與物品色混合時，物品色所佔的比例（底色要淡：暫存長條是淡藍色，底色太藍會和它混淆）
const TITLE_MIX = 0.55;
const BODY_MIX = 0.08;
const NODE_BASE = [30, 30, 30];

export function productColor(productId) {
    return PRODUCT_COLORS[productId] ?? FALLBACK_COLOR;
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
