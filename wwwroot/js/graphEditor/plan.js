// Editor 的存檔與載入：畫布 ⇄ C# 的 ProductionPlan。
import { LiteGraph } from "../../lib/litegraph/litegraph.es.js";
import { NOTE_TYPE, sourceTypeName, typeName } from "./shared.js";

export class PlanMethods {
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
}
