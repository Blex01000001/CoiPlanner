// 包裝 @comfyorg/litegraph 的節點編輯器（入口）。實作拆在 graphEditor/ 資料夾的 ES 模組：
//   editor.js    Editor 核心：建立畫布並覆寫 litegraph 行為、事件、拖放匯入、釋放
//   plan.js      存檔與載入（畫布 ⇄ ProductionPlan）：load、snapshot
//   status.js    顯示 C# 的結果：applyResult、applySimulation、節點狀態標籤與顏色
//   flow.js      連線外觀：線寬、移動的箭頭、流量標籤
//   viewport.js  背景格線、fit view
//   menus.js     右鍵選單、連線選單與其動作（複製、註解、群組）
//   nodes.js     節點類型：機器、資源來源、註解
//   shared.js    共用的狀態、格式化與常數
// Editor 的方法分散在 plan／status／flow／viewport／menus.js，由 editor.js 的 mixin() 併入。
//
// 這裡只負責畫面：使用者每次修改後把規劃送回 C#；檢查結果由 applyResult、模擬狀態由 applySimulation 傳回來顯示。
//
// wwwroot/lib/litegraph 保持原樣不修改，需要不同行為時在 graphEditor/ 覆寫：
// - 節點子類（nodes.js）：connectSlots（合流插槽）、computeSize（插槽數固定）、snapToGrid（對齊含標題的外框）
// - canvas 實例（editor.js 的 constructor）：processContextMenu／showLinkMenu（中文選單）、renderLink（依等級的線寬）、
//   onRenderBackground（格線，必須在群組之前畫）、showSearchBox（中文標題）、onNodeDblClicked（編輯註解）
// - canvas 大小由 fitCanvas 依 devicePixelRatio 設定；Shift 對齊由 window 上的事件切換 LiteGraph.alwaysSnapToGrid
import { Editor } from "./graphEditor/editor.js";
import { registerNodeTypes } from "./graphEditor/nodes.js";
import { state } from "./graphEditor/shared.js";

/** 讓瀏覽器把文字存成檔案下載。 */
export function downloadText(fileName, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
}

export function createEditor(canvasEl, dotnetRef, catalog, plan, maxImportBytes) {
    state.editor?.dispose();
    registerNodeTypes(catalog);
    state.editor = new Editor(canvasEl, dotnetRef, catalog, maxImportBytes);
    state.editor.load(plan);
    return state.editor;
}
