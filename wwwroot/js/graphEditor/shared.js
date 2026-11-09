// 各模組共用：目前的編輯器、數字格式、節點類型名稱，以及跨模組使用的常數。

// litegraph 的節點類型是全域註冊的，同一時間只會有一個編輯器；節點類別透過它回報修改
export const state = { editor: null };

// 背景格線的細線間距，也是按住 Shift 時的對齊間距（viewport.js 畫格線、editor.js 設定 litegraph 的對齊間距）
export const GRID_SIZE = 20;

// 註解節點的類型名稱
export const NOTE_TYPE = "其他/註解";

// 節點狀態標籤與連線流量標籤共用的底色
export const FLOW_LABEL_BGCOLOR = "rgba(24, 24, 24, 0.9)";

export function typeName(t) {
    return `${t.machineCategory}/${t.machineName}/${t.recipeName}`;
}

export function sourceTypeName(p) {
    return `資源/${p.name}`;
}

export function formatRate(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

export function round1(value) {
    return Math.round(value * 10) / 10;
}
