// 節點類型：機器節點、資源來源節點、註解節點，由 registerNodeTypes 註冊到 litegraph。
import { LiteGraph, LGraphCanvas, LGraphNode } from "../../lib/litegraph/litegraph.es.js";
import { NOTE_TYPE, sourceTypeName, state, typeName } from "./shared.js";

// 註解節點
const NOTE_COLOR = "#5a5328";
const NOTE_BGCOLOR = "#3a3620";
const NOTE_SIZE = [260, 120];
const NOTE_FONT = "14px Arial";
const NOTE_LINE_HEIGHT = 18;
const NOTE_PADDING = 10;
const NOTE_TEXT_COLOR = "#e8e0b0";
const NOTE_PLACEHOLDER_COLOR = "#8a8466";
const MIN_NODE_WIDTH = 260;
const SOURCE_NODE_COLOR = "#2f5a44";
const SOURCE_NODE_BGCOLOR = "#22352c";

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

export function registerNodeTypes(catalog) {
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
                    state.editor?.changed();
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
                state.editor?.changed();
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
                            const tier = state.editor?.linkTiers.get(link.id);
                            this.disconnectInput(this.inputs.indexOf(linked), true);
                            const moved = origin.connect(link.origin_slot, this, i);
                            if (moved && tier) state.editor.linkTiers.set(moved.id, tier);
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
                    state.editor?.changed();
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
                state.editor?.changed();
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
