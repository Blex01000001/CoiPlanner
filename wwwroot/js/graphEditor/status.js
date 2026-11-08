// Editor 顯示 C# 傳回的結果：規劃檢查（標紅）、模擬狀態（插槽速率、節點狀態標籤與顏色）。
import { LiteGraph } from "../../lib/litegraph/litegraph.es.js";
import { nodeColors, primaryProductId } from "./colors.js";
import { FLOW_LABEL_BGCOLOR, formatRate, round1 } from "./shared.js";

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

export class StatusMethods {
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
            link.color = bad ? ISSUE_LINK_COLOR : undefined; // undefined 時用物品顏色
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
            // 平常依主要物品上色，有問題或停擺時標紅
            const red = this.badNodes.has(id) || this.badLinkNodes.has(id) || isMachineStopped(node, state);
            const own = nodeColors(primaryProductId(node));
            node.color = red ? ISSUE_NODE_COLOR : own.color;
            node.bgcolor = red ? ISSUE_NODE_BGCOLOR : own.bgcolor;
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

function isMachineStopped(node, state) {
    return node.properties.kind !== "source" && (state?.status === "Starved" || state?.status === "Blocked");
}
