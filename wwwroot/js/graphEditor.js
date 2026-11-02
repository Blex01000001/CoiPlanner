// 包裝 @comfyorg/litegraph 的節點編輯器。
// 這裡只負責畫面：使用者每次修改後把規劃送回 C#；檢查結果由 applyResult、模擬狀態由 applySimulation 傳回來顯示。
//
// wwwroot/lib/litegraph 保持原樣不修改，需要不同行為時在這裡覆寫：
// - 節點子類：connectSlots（合流插槽）、computeSize（插槽數固定）、snapToGrid（對齊含標題的外框）
// - canvas 實例：processContextMenu／showLinkMenu（中文選單）、renderLink（依等級的線寬）、
//   onRenderBackground（格線，必須在群組之前畫）、showSearchBox（中文標題）、onNodeDblClicked（編輯註解）
// - canvas 大小由 fitCanvas 依 devicePixelRatio 設定；Shift 對齊由 window 上的事件切換 LiteGraph.alwaysSnapToGrid
import { LiteGraph, LGraph, LGraphCanvas, LGraphNode, LinkMarkerShape } from "../lib/litegraph/litegraph.es.js";

const ISSUE_NODE_COLOR = "#7a2a2a";
const ISSUE_NODE_BGCOLOR = "#3f1f1f";
const ISSUE_LINK_COLOR = "#e05555";
// 節點上方的狀態標籤：正常生產綠色、減產黃色；停擺、規劃或連線有問題的機器紅色（節點也標紅）
const STATUS_FONT = "bold 12px Arial";
const STATUS_COLORS = {
    stopped: "#ff6b6b",
    starting: "#5dade2",
    reduced: "#f4d03f",
    running: "#58d68d",
    source: "#a9c4b3",
};
const CHANGE_DEBOUNCE_MS = 80;
// 背景格線：細線間距即按住 Shift 時的對齊間距，每 GRID_MAJOR_EVERY 格一條粗線；縮小到 GRID_MINOR_MIN_SCALE 以下不畫細線
const GRID_SIZE = 20;
const GRID_MAJOR_EVERY = 5;
const GRID_MINOR_MIN_SCALE = 0.6;
const GRID_BGCOLOR = "#191919";
const GRID_MINOR_COLOR = "#131313";
const GRID_MAJOR_COLOR = "#0c0c0c";
// 連線粗細依運輸等級的吞吐量：每加倍粗 LINK_WIDTH_PER_DOUBLING（60/分 為 LINK_BASE_WIDTH）
const LINK_BASE_WIDTH = 3;
const LINK_BASE_CAPACITY = 60;
const LINK_WIDTH_PER_DOUBLING = 1.5;
// 一鍵定位整個工作流時，四周（含節點上方的狀態標籤）留的邊距，以及最大放大倍率
const FIT_PADDING = 40;
const FIT_MAX_SCALE = 1.5;
const FIT_ANIMATION_MS = 350;
// 註解節點
const NOTE_TYPE = "其他/註解";
const NOTE_COLOR = "#5a5328";
const NOTE_BGCOLOR = "#3a3620";
const NOTE_SIZE = [260, 120];
const NOTE_FONT = "14px Arial";
const NOTE_LINE_HEIGHT = 18;
const NOTE_PADDING = 10;
const NOTE_TEXT_COLOR = "#e8e0b0";
const NOTE_PLACEHOLDER_COLOR = "#8a8466";
// 新增群組時，沒有選取節點的預設大小，以及框住選取節點時四周留的邊距
const GROUP_SIZE = [400, 300];
const GROUP_PADDING = 20;
// 右鍵選單「顏色」的中文名稱，對應 litegraph 內建的 LGraphCanvas.node_colors
const COLOR_NAMES = {
    red: "紅", brown: "棕", green: "綠", blue: "藍", pale_blue: "淺藍",
    cyan: "青", purple: "紫", yellow: "黃", black: "黑",
};
const MIN_NODE_WIDTH = 260;
const SOURCE_NODE_COLOR = "#2f5a44";
const SOURCE_NODE_BGCOLOR = "#22352c";
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
const FLOW_LABEL_BGCOLOR = "rgba(24, 24, 24, 0.9)";

LiteGraph.CANVAS_GRID_SIZE = GRID_SIZE;

// litegraph 的節點類型是全域註冊的，同一時間只會有一個編輯器
let current = null;

function typeName(t) {
    return `${t.machineName}/${t.recipeName}`;
}

function sourceTypeName(p) {
    return `資源/${p.name}`;
}

/**
 * 輸入插槽已有連線時，把新的連線改接到同一位置上的合流插槽（見 CoiNode.mergeSlotFor）。
 * litegraph 拖曳連線時直接呼叫輸出端節點的 connectSlots，所以要覆寫在輸出端。
 */
function connectSlotsWithMerge(node, output, inputNode, input, afterRerouteId) {
    if (input?.link != null && inputNode.mergeSlotFor)
        input = inputNode.mergeSlotFor(input);
    return LGraphNode.prototype.connectSlots.call(node, output, inputNode, input, afterRerouteId);
}

/**
 * 按住 Shift 拖動節點時對齊格線。litegraph 預設對齊節點本體的左上角（標題列下方），
 * 改成對齊含標題列的外框，節點的上緣才會落在格線上；調整大小時 litegraph 本來就是對齊外框。
 */
function snapNodeToGrid(node, snapTo) {
    if (node.pinned || !snapTo) return false;
    const title = LiteGraph.NODE_TITLE_HEIGHT;
    node.pos[0] = Math.round(node.pos[0] / snapTo) * snapTo;
    node.pos[1] = Math.round((node.pos[1] - title) / snapTo) * snapTo + title;
    return true;
}

function registerNodeTypes(catalog) {
    for (const t of catalog.nodeTypes) {
        class CoiNode extends LGraphNode {
            static title = `${t.machineName} · ${t.recipeName}`;

            constructor(title) {
                super(title ?? CoiNode.title);
                this.properties = { machineId: t.machineId, recipeId: t.recipeId, count: 1 };
                this.slotInfo = { inputs: t.inputs, outputs: t.outputs };
                // 插槽類型用 productId，litegraph 只允許相同物品的輸出接到輸入
                for (const p of t.inputs) this.addInput(p.name, p.productId);
                for (const p of t.outputs) this.addOutput(p.name, p.productId);
                this.countWidget = this.addWidget("number", "數量", 1, v => {
                    const count = Math.max(1, Math.round(v));
                    this.properties.count = count;
                    this.countWidget.value = count;
                    current?.changed();
                }, { min: 1, step: 10, precision: 0 });
                this.size = this.computeSize();
            }

            computeSize(out) {
                const size = super.computeSize(out);
                size[0] = Math.max(size[0], MIN_NODE_WIDTH);
                // 合流插槽疊在原插槽上，不佔高度；節點高度只依配方的輸入／輸出數量
                const rows = Math.max(this.inputs.length, this.outputs.length, 1);
                const fixedRows = Math.max(t.inputs.length, t.outputs.length, 1);
                size[1] -= (rows - fixedRows) * LiteGraph.NODE_SLOT_HEIGHT;
                return size;
            }

            connectSlots(output, inputNode, input, afterRerouteId) {
                return connectSlotsWithMerge(this, output, inputNode, input, afterRerouteId);
            }

            snapToGrid(snapTo) {
                return snapNodeToGrid(this, snapTo);
            }

            /**
             * 插槽數量固定為配方的輸入數量（前 t.inputs.length 個）。
             * litegraph 一個輸入插槽只能接一條線，所以同一物品的第二條以後的連線接到「合流插槽」：
             * 隱藏在原插槽同一位置、只在有連線時存在，看起來就像一個插槽接了多條線。
             */
            mergeSlotFor(input) {
                const i = this.inputs.indexOf(input);
                const primary = i >= 0 && i < t.inputs.length ? i : t.inputs.findIndex(p => p.productId === input.type);
                const y = (this.constructor.slot_start_y || 0) + (primary + 0.7) * LiteGraph.NODE_SLOT_HEIGHT;
                // label 用空白：合流插槽與原插槽重疊，不能再畫一次名稱
                return this.addInput(t.inputs[primary].name, input.type, {
                    pos: [LiteGraph.NODE_SLOT_HEIGHT * 0.5, y],
                    label: " ",
                });
            }

            onConnectionsChange(type) {
                // litegraph 還在處理連線時不能增減插槽，等這一輪結束再整理
                if (type === LiteGraph.INPUT) queueMicrotask(() => this.graph && this.syncInputSlots());
                current?.changed();
            }

            /**
             * 整理合流插槽：原插槽空了但還有合流連線時，把一條移回原插槽
             * （拖曳插槽時 litegraph 只抓得到原插槽），沒有連線的合流插槽收回。
             */
            syncInputSlots() {
                if (this.syncing) return;
                this.syncing = true;
                try {
                    for (const [i, p] of t.inputs.entries()) {
                        const isMerge = s => this.inputs.indexOf(s) >= t.inputs.length && s.type === p.productId;
                        const linked = this.inputs.find(s => isMerge(s) && s.link != null);
                        if (this.inputs[i].link == null && linked) {
                            const link = this.graph._links.get(linked.link);
                            const origin = this.graph.getNodeById(link.origin_id);
                            // 重接會產生新的連線 id，等級要跟著搬過去
                            const tier = current?.linkTiers.get(link.id);
                            this.disconnectInput(this.inputs.indexOf(linked), true);
                            const moved = origin.connect(link.origin_slot, this, i);
                            if (moved && tier) current.linkTiers.set(moved.id, tier);
                        }
                    }
                    for (let i = this.inputs.length - 1; i >= t.inputs.length; i--) {
                        if (this.inputs[i].link == null) this.removeInput(i);
                    }
                } finally {
                    this.syncing = false;
                }
                this.size[1] = this.computeSize()[1];
                this.setDirtyCanvas(true, true);
            }

            // litegraph 刪除節點時會把上游直接接到下游；產線上這會憑空多出連線，所以停用
            connectInputToOutput() { }
        }
        LiteGraph.registerNodeType(typeName(t), CoiNode);
    }

    for (const p of catalog.products) {
        // 資源來源：只有一個輸出，每分鐘產量由使用者輸入
        class SourceNode extends LGraphNode {
            static title = `資源 · ${p.name}`;
            static color = SOURCE_NODE_COLOR;
            static bgcolor = SOURCE_NODE_BGCOLOR;

            constructor(title) {
                super(title ?? SourceNode.title);
                this.properties = { kind: "source", productId: p.productId, rate: 0 };
                this.slotInfo = { inputs: [], outputs: [p] };
                this.addOutput(p.name, p.productId);
                this.rateWidget = this.addWidget("number", `每分鐘 (${p.unit})`, 0, v => {
                    const rate = Math.max(0, v);
                    this.properties.rate = rate;
                    this.rateWidget.value = rate;
                    current?.changed();
                }, { min: 0, step: 10, precision: 2 });
                this.size = this.computeSize();
            }

            computeSize(out) {
                const size = super.computeSize(out);
                size[0] = Math.max(size[0], MIN_NODE_WIDTH);
                return size;
            }

            connectSlots(output, inputNode, input, afterRerouteId) {
                return connectSlotsWithMerge(this, output, inputNode, input, afterRerouteId);
            }

            snapToGrid(snapTo) {
                return snapNodeToGrid(this, snapTo);
            }

            onConnectionsChange() {
                current?.changed();
            }
        }
        LiteGraph.registerNodeType(sourceTypeName(p), SourceNode);
    }

    LiteGraph.registerNodeType(NOTE_TYPE, NoteNode);
}

/** 文字註解：只用來整理畫面，不參與計算與模擬。內容在右鍵選單或連點兩下時編輯。 */
class NoteNode extends LGraphNode {
    static title = "註解";
    static color = NOTE_COLOR;
    static bgcolor = NOTE_BGCOLOR;

    constructor(title) {
        super(title ?? NoteNode.title);
        // colorName 是 LGraphCanvas.node_colors 的名稱，null 代表預設顏色
        this.properties = { kind: "note", text: "", colorName: null };
        this.slotInfo = { inputs: [], outputs: [] };
        this.size = [...NOTE_SIZE];
    }

    snapToGrid(snapTo) {
        return snapNodeToGrid(this, snapTo);
    }

    setColorName(name) {
        const c = name ? LGraphCanvas.node_colors[name] : null;
        this.properties.colorName = c ? name : null;
        this.color = c?.color ?? NOTE_COLOR;
        this.bgcolor = c?.bgcolor ?? NOTE_BGCOLOR;
    }

    onDrawForeground(ctx) {
        if (this.flags.collapsed) return;
        const text = this.properties.text;
        const width = this.size[0] - NOTE_PADDING * 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, this.size[0], this.size[1]);
        ctx.clip();
        ctx.font = NOTE_FONT;
        ctx.fillStyle = text ? NOTE_TEXT_COLOR : NOTE_PLACEHOLDER_COLOR;
        ctx.textBaseline = "top";
        const lines = text ? wrapText(ctx, text, width) : ["（連點兩下編輯內容）"];
        lines.forEach((line, i) => ctx.fillText(line, NOTE_PADDING, NOTE_PADDING + i * NOTE_LINE_HEIGHT));
        ctx.restore();
    }
}

/** 依寬度斷行；中文沒有空白，所以逐字斷行，並保留使用者自己的換行。 */
function wrapText(ctx, text, width) {
    const lines = [];
    for (const paragraph of text.split("\n")) {
        let line = "";
        for (const ch of paragraph) {
            if (line && ctx.measureText(line + ch).width > width) {
                lines.push(line);
                line = ch;
            } else {
                line += ch;
            }
        }
        lines.push(line);
    }
    return lines;
}

function formatRate(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

class Editor {
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

    /** 以 C# 的 ProductionPlan 重建畫布。 */
    load(plan) {
        this.loading = true;
        try {
            this.graph.clear();
            this.linkTiers.clear();
            const created = new Map();
            for (const n of plan.nodes) {
                const t = this.typesById.get(`${n.machineId}|${n.recipeId}`);
                if (!t) continue;
                const node = LiteGraph.createNode(typeName(t));
                node.pos = [n.x, n.y];
                node.properties.count = n.count;
                node.countWidget.value = n.count;
                this.graph.add(node);
                created.set(n.id, node);
            }
            for (const s of plan.sources) {
                const p = this.productsById.get(s.productId);
                if (!p) continue;
                const node = LiteGraph.createNode(sourceTypeName(p));
                node.pos = [s.x, s.y];
                node.properties.rate = s.ratePerMinute;
                node.rateWidget.value = s.ratePerMinute;
                this.graph.add(node);
                created.set(s.id, node);
            }
            for (const n of plan.notes ?? []) {
                const node = LiteGraph.createNode(NOTE_TYPE);
                node.pos = [n.x, n.y];
                node.title = n.title;
                node.properties.text = n.text;
                node.setColorName(n.color);
                if (n.width > 0 && n.height > 0) node.size = [n.width, n.height];
                this.graph.add(node);
            }
            for (const g of plan.groups ?? []) {
                const group = new LiteGraph.LGraphGroup(g.title);
                group.pos = [g.x, g.y];
                group.size = [g.width, g.height];
                if (g.color) group.color = g.color;
                this.graph.add(group);
            }
            for (const e of plan.edges) {
                const source = created.get(e.sourceNodeId);
                const target = created.get(e.targetNodeId);
                if (!source || !target) continue;
                const out = source.outputs.findIndex(s => s.type === e.productId);
                const inp = target.inputs.findIndex(s => s.type === e.productId);
                // 原插槽已有連線時 connectSlots 會改接到合流插槽
                if (out < 0 || inp < 0) continue;
                const link = source.connect(out, target, inp);
                if (link) this.linkTiers.set(link.id, e.tier);
            }
        } finally {
            this.loading = false;
        }
        this.changed();
    }

    changed() {
        if (this.loading) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.dotnetRef.invokeMethodAsync("OnGraphChanged", this.snapshot())
                .catch(err => console.error("OnGraphChanged 失敗", err));
        }, CHANGE_DEBOUNCE_MS);
    }

    /** 目前畫布轉成 C# 的 ProductionPlan；連線順序記在 edgeLinkIds，讓 EdgeIndex 對得回 litegraph 的連線。 */
    snapshot() {
        const isSource = n => n.properties.kind === "source";
        const isNote = n => n.properties.kind === "note";
        const nodes = this.graph._nodes.filter(n => !isSource(n) && !isNote(n)).map(n => ({
            id: String(n.id),
            machineId: n.properties.machineId,
            recipeId: n.properties.recipeId,
            count: n.properties.count,
            x: n.pos[0],
            y: n.pos[1],
        }));
        const sources = this.graph._nodes.filter(isSource).map(n => ({
            id: String(n.id),
            productId: n.properties.productId,
            ratePerMinute: n.properties.rate,
            x: n.pos[0],
            y: n.pos[1],
        }));

        this.edgeLinkIds = [];
        const edges = [];
        for (const link of this.graph._links.values()) {
            this.edgeLinkIds.push(link.id);
            edges.push({
                sourceNodeId: String(link.origin_id),
                targetNodeId: String(link.target_id),
                productId: String(link.type),
                // 一種物品型態只能走一種運輸，運輸方式由物品決定；使用者只選等級
                transport: this.transportFor(link.type)?.id ?? "",
                tier: this.linkTiers.get(link.id) ?? 1,
            });
        }
        const notes = this.graph._nodes.filter(isNote).map(n => ({
            id: String(n.id),
            title: n.title,
            text: n.properties.text,
            x: n.pos[0],
            y: n.pos[1],
            width: n.size[0],
            height: n.size[1],
            color: n.properties.colorName,
        }));
        const groups = this.graph._groups.map(g => ({
            title: g.title,
            x: g.pos[0],
            y: g.pos[1],
            width: g.size[0],
            height: g.size[1],
            color: g.color ?? null,
        }));
        return { nodes, sources, edges, groups, notes };
    }

    /** 顯示 C# PlanCalculator 的檢查結果：有問題的節點與連線標紅。 */
    applyResult(result) {
        this.badNodes = new Set(result.issues.filter(i => i.nodeId != null).map(i => i.nodeId));
        const badLinks = new Set(result.issues
            .filter(i => i.edgeIndex != null)
            .map(i => this.edgeLinkIds[i.edgeIndex]));
        // 有問題的連線兩端的機器（不含資源節點）也要標紅
        this.badLinkNodes = new Set();
        for (const link of this.graph._links.values()) {
            const bad = badLinks.has(link.id);
            link.color = bad ? ISSUE_LINK_COLOR : undefined;
            if (!bad) continue;
            for (const id of [link.origin_id, link.target_id]) {
                if (this.graph.getNodeById(id)?.properties.kind !== "source")
                    this.badLinkNodes.add(String(id));
            }
        }
        this.applyNodeStyles();
    }

    /** 顯示 C# ProductionSimulator 的狀態：插槽標上「實際/額定」速率，停擺的機器標紅。 */
    applySimulation(sim) {
        this.nodeStates = new Map(sim.nodes.map(n => [n.nodeId, n]));
        this.edgeResults = new Map(sim.edges.map(e => [this.edgeLinkIds[e.edgeIndex], e]));
        this.applyNodeStyles();
    }

    applyNodeStyles() {
        for (const node of this.graph._nodes) {
            // 註解不參與模擬，顏色由使用者自己選
            if (node.properties.kind === "note") continue;
            const id = String(node.id);
            const state = this.nodeStates.get(id);
            label(node.inputs, node.slotInfo.inputs, state?.inputs);
            label(node.outputs, node.slotInfo.outputs, state?.outputs);
            // 標籤變長時只加寬不縮窄，避免使用者手動拉寬的節點被縮回去
            node.size[0] = Math.max(node.size[0], node.computeSize()[0]);
            // 設成 undefined 時會回到節點類型自己的顏色（資源節點是綠色）
            const red = this.badNodes.has(id) || this.badLinkNodes.has(id) || isMachineStopped(node, state);
            node.color = red ? ISSUE_NODE_COLOR : undefined;
            node.bgcolor = red ? ISSUE_NODE_BGCOLOR : undefined;
        }
        this.canvas.setDirty(true, true);
    }

    /** 節點上方的狀態文字與顏色；規劃或連線有問題時優先顯示，其他情況沒有模擬狀態就不顯示。 */
    statusOf(node, state) {
        const id = String(node.id);
        if (this.badNodes.has(id))
            return { text: "規劃有誤", color: STATUS_COLORS.stopped };
        if (this.badLinkNodes.has(id))
            return { text: "連線有問題", color: STATUS_COLORS.stopped };
        if (!state)
            return null;
        const pct = `${Math.round(state.utilization * 100)}%`;
        if (node.properties.kind === "source")
            return { text: `供應 ${pct}`, color: STATUS_COLORS.source };
        switch (state.status) {
            case "Starved": {
                const names = state.missingInputs.map(id => this.productsById.get(id)?.name ?? id).join("、");
                return { text: `停擺：缺${names}`, color: STATUS_COLORS.stopped };
            }
            case "Blocked":
                return { text: "停擺：輸出堵塞", color: STATUS_COLORS.stopped };
            case "Starting":
                return { text: `啟動中 ${state.startupRemainingSeconds.toFixed(1)} 秒`, color: STATUS_COLORS.starting };
            default:
                return state.utilization < 0.995
                    ? { text: `減產 ${pct}`, color: STATUS_COLORS.reduced }
                    : { text: `運轉中 ${pct}`, color: STATUS_COLORS.running };
        }
    }

    drawStatus(ctx) {
        ctx.font = STATUS_FONT;
        for (const node of this.graph._nodes) {
            const status = this.statusOf(node, this.nodeStates.get(String(node.id)));
            if (!status) continue;
            const { text, color } = status;
            const x = node.pos[0];
            const y = node.pos[1] - LiteGraph.NODE_TITLE_HEIGHT - 12;
            const w = ctx.measureText(text).width + 10;
            ctx.fillStyle = FLOW_LABEL_BGCOLOR;
            ctx.beginPath();
            ctx.roundRect(x, y - 9, w, 18, 4);
            ctx.fill();
            ctx.fillStyle = color;
            ctx.textBaseline = "middle";
            ctx.fillText(text, x + 5, y + 1);
            ctx.textBaseline = "alphabetic";
        }
    }

    transportFor(productId) {
        return this.transportsByKind.get(this.productsById.get(String(productId))?.kind);
    }

    /** 點連線中間（流量標籤）時的選單：選擇運輸等級或刪除連線。取代 litegraph 預設的連線選單。 */
    showLinkMenu(segment, e) {
        const transport = this.transportFor(segment.type);
        const tier = this.linkTiers.get(segment.id) ?? 1;
        const items = (transport?.tiersPerMinute ?? []).map((cap, i) => ({
            content: `${i + 1 === tier ? "✓ " : ""}${i + 1} 級（${formatRate(cap)}/分）`,
            callback: () => {
                this.linkTiers.set(segment.id, i + 1);
                this.changed();
            },
        }));
        if (items.length) items.push(null);
        items.push({ content: "刪除連線", callback: () => this.graph.removeLink(segment.id) });
        new LiteGraph.ContextMenu(items, { event: e, title: transport?.name ?? "連線" });
        return false;
    }

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

            ctx.fillStyle = link.color ?? this.canvas.default_link_color;
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
        ctx.strokeStyle = full ? FLOW_LABEL_FULL_COLOR : link.color ?? this.canvas.default_link_color;
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

    /** 右鍵選單：在節點上（含插槽）或在畫布空白處（含群組）各有不同項目。 */
    showContextMenu(node, e) {
        const items = node ? this.nodeMenu(node, e) : this.canvasMenu(e);
        if (!items?.length) return;
        new LiteGraph.ContextMenu(items, { event: e, title: node?.title });
    }

    canvasMenu(e) {
        const pos = [e.canvasX, e.canvasY];
        const selected = this.graph._nodes.filter(n => n.is_selected);
        const items = [
            { content: "新增節點", has_submenu: true, callback: LGraphCanvas.onMenuAdd },
            { content: "新增註解", callback: () => this.addNote(pos) },
            {
                content: selected.length ? `新增群組（框住選取的 ${selected.length} 個節點）` : "新增群組",
                callback: () => this.addGroup(pos, selected, e),
            },
        ];
        const group = this.graph.getGroupOnPos(pos[0], pos[1]);
        if (group) {
            items.push(null, ...this.groupMenu(group, e));
        }
        return items;
    }

    groupMenu(group, e) {
        return [
            { content: `重新命名群組「${group.title}」`, callback: () => this.renameGroup(group, e) },
            { content: "群組顏色", has_submenu: true, submenu: { title: "群組顏色", options: this.colorMenu((c) => group.color = c?.groupcolor) } },
            { content: "刪除群組（保留裡面的節點）", callback: () => { this.graph.remove(group); this.changed(); } },
        ];
    }

    nodeMenu(node, e) {
        const slot = node.getSlotInPosition(e.canvasX, e.canvasY);
        if (slot) return this.slotMenu(node, slot);

        const items = [];
        if (node.properties.kind === "note") {
            items.push(
                { content: "編輯內容", callback: () => this.editNote(node, e) },
                { content: "重新命名", callback: () => this.renameNote(node, e) },
                { content: "顏色", has_submenu: true, submenu: { title: "顏色", options: this.colorMenu((c, name) => node.setColorName(name)) } },
                null);
        }
        items.push(
            { content: "複製", callback: () => this.cloneNode(node) },
            { content: "刪除", callback: () => this.graph.remove(node) });
        return items;
    }

    /** 插槽上的選單：中斷這種物品的所有連線（輸入合流時一次中斷全部）。沒有連線時不顯示選單。 */
    slotMenu(node, slot) {
        const productId = (slot.input ?? slot.output).type;
        if (slot.input) {
            const linked = node.inputs.filter(s => s.type === productId && s.link != null);
            if (!linked.length) return null;
            return [{
                content: linked.length > 1 ? `中斷全部 ${linked.length} 條連線` : "中斷連線",
                callback: () => {
                    for (const s of linked) node.disconnectInput(node.inputs.indexOf(s), true);
                },
            }];
        }
        if (!slot.output.links?.length) return null;
        return [{
            content: slot.output.links.length > 1 ? `中斷全部 ${slot.output.links.length} 條連線` : "中斷連線",
            callback: () => node.disconnectOutput(slot.slot),
        }];
    }

    /** 顏色選單；apply(顏色, 名稱) 收到 null 代表恢復預設顏色。 */
    colorMenu(apply) {
        const choose = (c, name) => () => {
            apply(c, name);
            this.canvas.setDirty(true, true);
            this.changed();
        };
        return [
            { content: "預設", callback: choose(null, null) },
            null,
            ...Object.entries(LGraphCanvas.node_colors).map(([name, c]) => ({ content: COLOR_NAMES[name] ?? name, callback: choose(c, name) })),
        ];
    }

    /** 複製節點：機器數量、資源產量、註解內容一起帶過去，放在原節點右下方。 */
    cloneNode(node) {
        const copy = LiteGraph.createNode(node.type);
        if (!copy) return;
        const p = node.properties;
        if (p.kind === "source") {
            copy.properties.rate = p.rate;
            copy.rateWidget.value = p.rate;
        } else if (p.kind === "note") {
            copy.title = node.title;
            copy.properties.text = p.text;
            copy.size = [...node.size];
            copy.setColorName(p.colorName);
        } else {
            copy.properties.count = p.count;
            copy.countWidget.value = p.count;
        }
        copy.pos = [node.pos[0] + 2 * GRID_SIZE, node.pos[1] + 2 * GRID_SIZE];
        this.graph.add(copy);
    }

    addNote(pos) {
        const node = LiteGraph.createNode(NOTE_TYPE);
        node.pos = [pos[0], pos[1]];
        this.graph.add(node);
        this.editNote(node);
    }

    editNote(node, e) {
        this.canvas.prompt("註解內容", node.properties.text, value => {
            node.properties.text = value;
            this.canvas.setDirty(true, true);
            this.changed();
        }, e, true);
    }

    renameNote(node, e) {
        this.canvas.prompt("標題", node.title, value => {
            if (value.trim()) node.title = value.trim();
            this.changed();
        }, e);
    }

    /** 有選取節點時建立剛好框住它們的群組，否則在點擊位置建立預設大小的群組；建立後立刻命名。 */
    addGroup(pos, selected, e) {
        const group = new LiteGraph.LGraphGroup("群組");
        if (selected.length) {
            group.resizeTo(selected, GROUP_PADDING);
        } else {
            group.pos = [pos[0], pos[1]];
            group.size = [...GROUP_SIZE];
        }
        this.graph.add(group);
        this.renameGroup(group, e);
        this.changed();
    }

    renameGroup(group, e) {
        this.canvas.prompt("群組名稱", group.title, value => {
            if (value.trim()) group.title = value.trim();
            this.canvas.setDirty(true, true);
            this.changed();
        }, e);
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

    /** 連線的線寬：運輸等級的吞吐量每加倍就粗一些；等級有誤時用基本線寬。 */
    linkWidth(link) {
        const capacity = this.transportFor(link.type)?.tiersPerMinute[(this.linkTiers.get(link.id) ?? 1) - 1];
        if (!capacity) return LINK_BASE_WIDTH;
        return LINK_BASE_WIDTH + LINK_WIDTH_PER_DOUBLING * Math.log2(Math.max(1, capacity / LINK_BASE_CAPACITY));
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
        if (current === this) current = null;
    }
}

/** 每種物品的第一個插槽標上「實際/額定」每分鐘速率（實際為最近幾秒平均）；合流用的其他插槽留白。 */
function label(slots, infos, states) {
    const seen = new Set();
    for (const slot of slots) {
        const info = infos.find(i => i.productId === slot.type);
        if (!info) continue;
        const state = states?.find(r => r.productId === info.productId);
        const first = !seen.has(info.productId);
        seen.add(info.productId);
        // 合流插槽疊在原插槽上，標籤留白才不會重疊
        slot.label = !first ? " "
            : state ? `${info.name}  ${formatRate(round1(state.actualPerMinute))}/${formatRate(state.ratedPerMinute)} ${info.unit}/分`
            : info.name;
    }
}

function round1(value) {
    return Math.round(value * 10) / 10;
}

function isMachineStopped(node, state) {
    return node.properties.kind !== "source" && (state?.status === "Starved" || state?.status === "Blocked");
}

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
    current?.dispose();
    registerNodeTypes(catalog);
    current = new Editor(canvasEl, dotnetRef, catalog, maxImportBytes);
    current.load(plan);
    return current;
}
