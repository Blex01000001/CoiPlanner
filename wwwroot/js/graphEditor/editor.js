// Editor：把 litegraph 畫布、C# 互動與各功能模組組在一起。
// 這裡有建立畫布時對 litegraph 的覆寫、事件、拖放匯入與釋放；其餘方法在 plan／status／flow／viewport／menus.js。
import { LiteGraph, LGraph, LGraphCanvas, LinkMarkerShape } from "../../lib/litegraph/litegraph.es.js";
import { FlowMethods } from "./flow.js";
import { MenuMethods } from "./menus.js";
import { PlanMethods } from "./plan.js";
import { GRID_SIZE, state } from "./shared.js";
import { StatusMethods } from "./status.js";
import { StockMethods } from "./stock.js";
import { ViewportMethods } from "./viewport.js";

const CHANGE_DEBOUNCE_MS = 80;

LiteGraph.CANVAS_GRID_SIZE = GRID_SIZE;

export class Editor {
    constructor(canvasEl, dotnetRef, catalog, maxImportBytes) {
        this.dotnetRef = dotnetRef;
        this.typesById = new Map(catalog.nodeTypes.map(t => [`${t.machineId}|${t.recipeId}`, t]));
        this.productsById = new Map(catalog.products.map(p => [p.productId, p]));
        this.transportsByKind = new Map(catalog.transports.map(t => [t.kind, t]));
        // 每條連線（litegraph 連線 id）的運輸等級；沒有記錄的是預設的一級
        this.linkTiers = new Map();
        // C# 模擬的每條連線流量與上限，key 是 litegraph 連線 id
        this.edgeResults = new Map();
        // C# 模擬的節點狀態，key 是節點 id（字串）
        this.nodeStates = new Map();
        // 規劃檢查有問題的節點 id，以及接著有問題連線的機器節點 id
        this.badNodes = new Set();
        this.badLinkNodes = new Set();
        // 每條連線箭頭目前的位移；速度隨流量改變，所以要逐幀累加而不是用時間直接算
        this.linkPhases = new Map();
        this.lastFrame = performance.now();
        this.loading = false;
        this.timer = null;
        this.edgeLinkIds = [];

        this.graph = new LGraph();
        this.canvas = new LGraphCanvas(canvasEl, this.graph);
        // 背景格線自己畫，間距才能和 Shift 對齊的間距一致（litegraph 內建的背景圖是 100px 一格）
        this.canvas.background_image = null;
        // 要在 onRenderBackground（群組之前）畫，用 onDrawBackground 會把群組蓋掉；回傳 true 讓 litegraph 不再畫底色
        this.canvas.onRenderBackground = (_, ctx) => {
            const dpr = window.devicePixelRatio || 1;
            ctx.save();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.canvas.ds.toCanvasContext(ctx);
            this.drawGrid(ctx, this.canvas.visible_area);
            ctx.restore();
            return true;
        };
        // litegraph 預設會在畫布座標原點畫一個藍色外框，fit view 時會被看到，關掉
        this.canvas.render_canvas_border = false;
        // 每條連線依運輸等級的吞吐量決定粗細：畫這條線時暫時換掉 litegraph 共用的線寬
        const renderLink = this.canvas.renderLink.bind(this.canvas);
        this.canvas.renderLink = (ctx, a, b, link, ...rest) => {
            const width = this.canvas.connections_width;
            if (link) this.canvas.connections_width = this.linkWidth(link);
            try {
                return renderLink(ctx, a, b, link, ...rest);
            } finally {
                this.canvas.connections_width = width;
            }
        };
        // 不畫連線中間的圓點（流向改由 drawFlow 的箭頭表示）；點連線中間仍可開啟連線選單
        this.canvas.linkMarkerShape = LinkMarkerShape.None;
        this.canvas.showLinkMenu = (segment, e) => this.showLinkMenu(segment, e);
        // litegraph 內建的右鍵選單是英文，而且有很多這個工具用不到的項目；換成自己的中文選單
        this.canvas.processContextMenu = (node, e) => this.showContextMenu(node, e);
        this.canvas.onNodeDblClicked = node => {
            if (node.properties.kind === "note") this.editNote(node);
        };
        // 連點兩下畫布開啟的搜尋框，標題改成中文
        const showSearchBox = this.canvas.showSearchBox.bind(this.canvas);
        this.canvas.showSearchBox = (...args) => {
            const dialog = showSearchBox(...args);
            const name = dialog?.querySelector?.(".name");
            if (name) name.textContent = "搜尋";
            return dialog;
        };
        this.graph.onNodeAdded = () => this.changed();
        this.graph.onNodeRemoved = () => this.changed();
        this.canvas.onNodeMoved = () => this.changed();
        // 群組的移動、調整大小沒有對應的事件；放開滑鼠時一律回報一次（會合併成一次更新）
        canvasEl.addEventListener("pointerup", () => this.changed());
        this.canvas.onDrawForeground = ctx => this.drawFlow(ctx);
        // litegraph 只在畫面變動時重繪；流量動畫需要每一幀都重繪
        const animate = () => {
            this.canvas.setDirty(true, false);
            this.animationFrame = requestAnimationFrame(animate);
        };
        this.animationFrame = requestAnimationFrame(animate);

        // litegraph 只在 canvas 本身收到 keydown 時處理 Delete 等快捷鍵，canvas 必須能取得焦點
        canvasEl.tabIndex = 0;
        canvasEl.addEventListener("pointerdown", () => canvasEl.focus({ preventScroll: true }));

        // litegraph 只在 canvas 有焦點時才知道 Shift 有沒有按著（先按 Shift 再點畫布就不會對齊）；
        // 改成在整個視窗追蹤，按著 Shift 時開啟對齊格線
        this.onShift = e => { LiteGraph.alwaysSnapToGrid = e.shiftKey; };
        this.onBlur = () => { LiteGraph.alwaysSnapToGrid = false; };
        for (const type of ["keydown", "keyup", "pointerdown", "pointermove"])
            window.addEventListener(type, this.onShift, true);
        window.addEventListener("blur", this.onBlur);

        const parent = canvasEl.parentElement;
        this.listenFileDrop(parent, maxImportBytes);
        // 顯示比例不是 100% 時（Windows 125%、150% 或瀏覽器縮放），canvas 的像素大小要是 CSS 大小 × devicePixelRatio，
        // 否則畫面模糊，背景也只畫到一部分。litegraph 只會自己放大背景層，節點所在的前景層要由這裡放大
        // （設定 canvas 大小會重設繪圖狀態，所以每次改大小後都要重新設定）
        this.fitCanvas = () => {
            const dpr = window.devicePixelRatio || 1;
            const [w, h] = [parent.clientWidth, parent.clientHeight];
            const [pw, ph] = [Math.round(w * dpr), Math.round(h * dpr)];
            canvasEl.style.width = `${w}px`;
            canvasEl.style.height = `${h}px`;
            if (canvasEl.width === pw && canvasEl.height === ph) return;
            this.canvas.resize(pw, ph);
            this.canvas.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        this.resizeObserver = new ResizeObserver(this.fitCanvas);
        this.resizeObserver.observe(parent);
        // 瀏覽器縮放或把視窗拖到不同顯示比例的螢幕時，大小不變但 devicePixelRatio 會變
        window.addEventListener("resize", this.fitCanvas);
    }

    changed() {
        if (this.loading) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.dotnetRef.invokeMethodAsync("OnGraphChanged", this.snapshot())
                .catch(err => console.error("OnGraphChanged 失敗", err));
        }, CHANGE_DEBOUNCE_MS);
    }

    transportFor(productId) {
        return this.transportsByKind.get(this.productsById.get(String(productId))?.kind);
    }

    /** 把 .json 檔拖到畫布上匯入；內容交給 C# 解析。 */
    listenFileDrop(el, maxBytes) {
        const hasFile = e => e.dataTransfer?.types.includes("Files");
        this.onDragOver = e => {
            if (!hasFile(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        };
        this.onDrop = async e => {
            if (!hasFile(e)) return;
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (!file) return;
            if (file.size > maxBytes) {
                alert(`檔案太大，上限為 ${Math.floor(maxBytes / 1024)} KB。`);
                return;
            }
            this.dotnetRef.invokeMethodAsync("OnFileDropped", file.name, await file.text())
                .catch(err => console.error("OnFileDropped 失敗", err));
        };
        el.addEventListener("dragover", this.onDragOver);
        el.addEventListener("drop", this.onDrop);
        this.dropTarget = el;
    }

    dispose() {
        for (const type of ["keydown", "keyup", "pointerdown", "pointermove"])
            window.removeEventListener(type, this.onShift, true);
        window.removeEventListener("blur", this.onBlur);
        LiteGraph.alwaysSnapToGrid = false;
        this.dropTarget.removeEventListener("dragover", this.onDragOver);
        this.dropTarget.removeEventListener("drop", this.onDrop);
        cancelAnimationFrame(this.animationFrame);
        clearTimeout(this.timer);
        this.resizeObserver.disconnect();
        window.removeEventListener("resize", this.fitCanvas);
        this.canvas.stopRendering();
        this.graph.clear();
        if (state.editor === this) state.editor = null;
    }
}

/**
 * Editor 的方法分散在 plan／status／flow／viewport／menus.js；那些檔案裡的類別只是方法的容器（不會被實例化），
 * 這裡把它們的方法併入 Editor.prototype。方法名稱不可重複，重複會在載入時拋錯。
 */
function mixin(target, ...sources) {
    for (const source of sources) {
        for (const name of Object.getOwnPropertyNames(source.prototype)) {
            if (name === "constructor") continue;
            if (Object.hasOwn(target.prototype, name))
                throw new Error(`Editor 方法重複：${name}（${source.name}）`);
            Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(source.prototype, name));
        }
    }
}

mixin(Editor, PlanMethods, StatusMethods, StockMethods, FlowMethods, ViewportMethods, MenuMethods);
