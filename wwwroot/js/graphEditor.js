// 包裝 @comfyorg/litegraph 的節點編輯器。
// 這裡只負責畫面：使用者每次修改後把規劃送回 C#，計算結果再由 C# 透過 applyResult 傳回來顯示。
import { LiteGraph, LGraph, LGraphCanvas, LGraphNode, LinkMarkerShape } from "../lib/litegraph/litegraph.es.js";

const ISSUE_NODE_COLOR = "#7a2a2a";
const ISSUE_NODE_BGCOLOR = "#3f1f1f";
const ISSUE_LINK_COLOR = "#e05555";
const CHANGE_DEBOUNCE_MS = 80;
const MIN_NODE_WIDTH = 260;
const SOURCE_NODE_COLOR = "#2f5a44";
const SOURCE_NODE_BGCOLOR = "#22352c";
// 流量動畫：箭頭沿連線方向移動，間距、速度與大小以畫布座標（px）計
const FLOW_ARROW_SPACING = 40;
const FLOW_ARROW_SPEED = 60;
const FLOW_ARROW_SIZE = 5;
// 連線中點的流量標籤；達到運輸上限時改用醒目的顏色與粗體
const FLOW_LABEL_FONT = "12px Arial";
const FLOW_LABEL_FULL_FONT = "bold 13px Arial";
const FLOW_LABEL_COLOR = "#ddd";
const FLOW_LABEL_FULL_COLOR = "#ff6b6b";
const FLOW_LABEL_BGCOLOR = "rgba(24, 24, 24, 0.9)";

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

            onConnectionsChange() {
                current?.changed();
            }
        }
        LiteGraph.registerNodeType(sourceTypeName(p), SourceNode);
    }
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
        // C# 算出的每條連線流量與上限，key 是 litegraph 連線 id
        this.edgeResults = new Map();
        this.loading = false;
        this.timer = null;
        this.edgeLinkIds = [];

        this.graph = new LGraph();
        this.canvas = new LGraphCanvas(canvasEl, this.graph);
        this.canvas.background_image = LGraphCanvas.DEFAULT_BACKGROUND_IMAGE;
        // 不畫連線中間的圓點（流向改由 drawFlow 的箭頭表示）；點連線中間仍可開啟連線選單
        this.canvas.linkMarkerShape = LinkMarkerShape.None;
        this.canvas.showLinkMenu = (segment, e) => this.showLinkMenu(segment, e);
        this.graph.onNodeAdded = () => this.changed();
        this.graph.onNodeRemoved = () => this.changed();
        this.canvas.onNodeMoved = () => this.changed();
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

        const parent = canvasEl.parentElement;
        this.listenFileDrop(parent, maxImportBytes);
        this.resizeObserver = new ResizeObserver(() => this.canvas.resize(parent.clientWidth, parent.clientHeight));
        this.resizeObserver.observe(parent);
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
        const nodes = this.graph._nodes.filter(n => !isSource(n)).map(n => ({
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
        return { nodes, sources, edges };
    }

    /** 顯示 C# PlanCalculator 的結果：插槽標上每分鐘速率，有問題的節點與連線標紅。 */
    applyResult(result) {
        const rates = new Map(result.nodes.map(r => [r.nodeId, r]));
        const badNodes = new Set(result.issues.filter(i => i.nodeId != null).map(i => i.nodeId));
        const badLinks = new Set(result.issues
            .filter(i => i.edgeIndex != null)
            .map(i => this.edgeLinkIds[i.edgeIndex]));

        for (const node of this.graph._nodes) {
            const id = String(node.id);
            const r = rates.get(id);
            label(node.inputs, node.slotInfo.inputs, r?.inputs);
            label(node.outputs, node.slotInfo.outputs, r?.outputs);
            // 標籤變長時只加寬不縮窄，避免使用者手動拉寬的節點被縮回去
            node.size[0] = Math.max(node.size[0], node.computeSize()[0]);
            // 設成 undefined 時會回到節點類型自己的顏色（資源節點是綠色）
            node.color = badNodes.has(id) ? ISSUE_NODE_COLOR : undefined;
            node.bgcolor = badNodes.has(id) ? ISSUE_NODE_BGCOLOR : undefined;
        }
        for (const link of this.graph._links.values()) {
            link.color = badLinks.has(link.id) ? ISSUE_LINK_COLOR : undefined;
        }
        this.edgeResults = new Map(result.edges.map(e => [this.edgeLinkIds[e.edgeIndex], e]));
        this.canvas.setDirty(true, true);
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

    /** 在每條連線上畫出沿方向移動的箭頭，表示物料流動（不代表實際流量）。 */
    drawFlow(ctx) {
        const offset = (performance.now() / 1000 * FLOW_ARROW_SPEED) % FLOW_ARROW_SPACING;
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

            ctx.fillStyle = link.color ?? this.canvas.default_link_color;
            for (let d = offset; d < length; d += FLOW_ARROW_SPACING) {
                const t = d / length;
                const [x, y] = this.canvas.computeConnectionPoint(a, b, t);
                if (hidden(x, y)) continue;
                // 箭頭方向取曲線在這一點附近的切線
                const [nx, ny] = this.canvas.computeConnectionPoint(a, b, Math.min(t + 0.01, 1));
                const [px, py] = this.canvas.computeConnectionPoint(a, b, Math.max(t - 0.01, 0));
                const angle = Math.atan2(ny - py, nx - px);
                const s = FLOW_ARROW_SIZE;
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

            this.drawFlowLabel(ctx, link, a, b, hidden);
        }
    }

    /** 在連線中點畫「流量/上限」；達到上限時用醒目的顏色與粗體。 */
    drawFlowLabel(ctx, link, a, b, hidden) {
        const r = this.edgeResults.get(link.id);
        if (r?.capacityPerMinute == null) return;
        const [x, y] = this.canvas.computeConnectionPoint(a, b, 0.5);
        if (hidden(x, y)) return;

        const full = r.flowPerMinute >= r.capacityPerMinute - 1e-9;
        const text = `${formatRate(r.flowPerMinute)}/${formatRate(r.capacityPerMinute)}`;
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
        this.dropTarget.removeEventListener("dragover", this.onDragOver);
        this.dropTarget.removeEventListener("drop", this.onDrop);
        cancelAnimationFrame(this.animationFrame);
        clearTimeout(this.timer);
        this.resizeObserver.disconnect();
        this.canvas.stopRendering();
        this.graph.clear();
        if (current === this) current = null;
    }
}

/** 每種物品的第一個插槽標上這個節點合計的每分鐘速率；合流用的其他插槽只標名稱。 */
function label(slots, infos, rates) {
    const seen = new Set();
    for (const slot of slots) {
        const info = infos.find(i => i.productId === slot.type);
        if (!info) continue;
        const rate = rates?.find(r => r.productId === info.productId);
        const first = !seen.has(info.productId);
        seen.add(info.productId);
        // 合流插槽疊在原插槽上，標籤留白才不會重疊
        slot.label = !first ? " " : rate ? `${info.name}  ${formatRate(rate.perMinute)} ${info.unit}/分` : info.name;
    }
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
