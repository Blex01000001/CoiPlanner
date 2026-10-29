// 包裝 @comfyorg/litegraph 的節點編輯器。
// 這裡只負責畫面：使用者每次修改後把規劃送回 C#，計算結果再由 C# 透過 applyResult 傳回來顯示。
import { LiteGraph, LGraph, LGraphCanvas, LGraphNode } from "../lib/litegraph/litegraph.es.js";

const ISSUE_NODE_COLOR = "#7a2a2a";
const ISSUE_NODE_BGCOLOR = "#3f1f1f";
const ISSUE_LINK_COLOR = "#e05555";
const CHANGE_DEBOUNCE_MS = 80;
const MIN_NODE_WIDTH = 260;
const SOURCE_NODE_COLOR = "#2f5a44";
const SOURCE_NODE_BGCOLOR = "#22352c";
// 流量動畫：小點沿連線方向移動，間距與速度以畫布座標（px）計
const FLOW_DOT_SPACING = 40;
const FLOW_DOT_SPEED = 60;
const FLOW_DOT_RADIUS = 3;

// litegraph 的節點類型是全域註冊的，同一時間只會有一個編輯器
let current = null;

function typeName(t) {
    return `${t.machineName}/${t.recipeName}`;
}

function sourceTypeName(p) {
    return `資源/${p.name}`;
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
                return size;
            }

            onConnectionsChange(type) {
                // litegraph 還在處理連線時不能增減插槽，等這一輪結束再整理
                if (type === LiteGraph.INPUT) queueMicrotask(() => this.graph && this.syncInputSlots());
                current?.changed();
            }

            /**
             * 讓每種輸入物品都保持「剛好一個空插槽」：接滿就多開一個，多出來的空插槽收回。
             * litegraph 一個輸入插槽只能接一條線，這樣才能讓多個來源合流到同一台機器。
             */
            syncInputSlots() {
                for (const p of t.inputs) {
                    const empty = this.inputs.filter(s => s.type === p.productId && s.link == null);
                    if (empty.length === 0) {
                        this.addInput(p.name, p.productId);
                    } else {
                        for (const extra of empty.slice(1))
                            this.removeInput(this.inputs.indexOf(extra));
                    }
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
    constructor(canvasEl, dotnetRef, catalog) {
        this.dotnetRef = dotnetRef;
        this.typesById = new Map(catalog.nodeTypes.map(t => [`${t.machineId}|${t.recipeId}`, t]));
        this.productsById = new Map(catalog.products.map(p => [p.productId, p]));
        this.loading = false;
        this.timer = null;
        this.edgeLinkIds = [];

        this.graph = new LGraph();
        this.canvas = new LGraphCanvas(canvasEl, this.graph);
        this.canvas.background_image = LGraphCanvas.DEFAULT_BACKGROUND_IMAGE;
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
        this.resizeObserver = new ResizeObserver(() => this.canvas.resize(parent.clientWidth, parent.clientHeight));
        this.resizeObserver.observe(parent);
    }

    /** 以 C# 的 ProductionPlan 重建畫布。 */
    load(plan) {
        this.loading = true;
        try {
            this.graph.clear();
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
                const inp = target.inputs.findIndex(s => s.type === e.productId && s.link == null);
                if (out >= 0 && inp >= 0) {
                    source.connect(out, target, inp);
                    // 載入時要立刻開出下一個空插槽，同一物品的下一條連線才接得上
                    target.syncInputSlots();
                }
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
                transport: "",
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
        this.canvas.setDirty(true, true);
    }

    /** 在每條連線上畫出沿方向移動的小點，表示物料流動（不代表實際流量）。 */
    drawFlow(ctx) {
        const offset = (performance.now() / 1000 * FLOW_DOT_SPEED) % FLOW_DOT_SPACING;
        for (const link of this.graph._links.values()) {
            const origin = this.graph.getNodeById(link.origin_id);
            const target = this.graph.getNodeById(link.target_id);
            if (!origin || !target) continue;

            const a = origin.getConnectionPos(false, link.origin_slot);
            const b = target.getConnectionPos(true, link.target_slot);
            // 以控制點的折線長度估算曲線長度，決定要畫幾個點
            const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.2;
            if (length < 1) continue;

            ctx.fillStyle = link.color ?? this.canvas.default_link_color;
            for (let d = offset; d < length; d += FLOW_DOT_SPACING) {
                const [x, y] = this.canvas.computeConnectionPoint(a, b, d / length);
                ctx.beginPath();
                ctx.arc(x, y, FLOW_DOT_RADIUS, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
    }

    dispose() {
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
        slot.label = first && rate ? `${info.name}  ${formatRate(rate.perMinute)} ${info.unit}/分` : info.name;
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

export function createEditor(canvasEl, dotnetRef, catalog, plan) {
    current?.dispose();
    registerNodeTypes(catalog);
    current = new Editor(canvasEl, dotnetRef, catalog);
    current.load(plan);
    return current;
}
