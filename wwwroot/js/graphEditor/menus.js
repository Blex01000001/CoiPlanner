// Editor 的右鍵選單、連線選單，以及選單觸發的動作（複製節點、新增與編輯註解、新增與命名群組）。
import { LiteGraph, LGraphCanvas } from "../../lib/litegraph/litegraph.es.js";
import { GRID_SIZE, NOTE_TYPE, formatRate } from "./shared.js";

// 新增群組時，沒有選取節點的預設大小，以及框住選取節點時四周留的邊距
const GROUP_SIZE = [400, 300];
const GROUP_PADDING = 20;
// 右鍵選單「顏色」的中文名稱，對應 litegraph 內建的 LGraphCanvas.node_colors
const COLOR_NAMES = {
    red: "紅", brown: "棕", green: "綠", blue: "藍", pale_blue: "淺藍",
    cyan: "青", purple: "紫", yellow: "黃", black: "黑",
};

export class MenuMethods {
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
}
