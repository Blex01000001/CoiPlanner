// Editor 的「連線放在空白處」跳窗：從插槽拖出連線，放在畫布空白處時，列出可以接上的節點（機器與配方，輸出端還有資源），
// 點選後在放開的位置新增節點並自動連線。litegraph 本身只有英文的連線選單（release_link_on_empty_shows_menu），這裡不使用。
import { LiteGraph } from "../../lib/litegraph/litegraph.es.js";
import { GRID_SIZE, formatRate, sourceTypeName, typeName } from "./shared.js";

// 資源節點的分類名稱，排在機器分類之後
const SOURCE_CATEGORY = "資源";

export class LinkPopupMethods {
    /** 建構時呼叫一次：監聽 litegraph 的「連線放在空白處」事件。 */
    listenLinkRelease() {
        this.onCanvasEvent = e => {
            if (e.detail?.subType !== "empty-release") return;
            const connector = this.canvas.linkConnector;
            const first = connector.renderLinks[0];
            // 拖的是既有連線（移動連線的一端）時，litegraph 會直接把它斷開，不開跳窗
            if (!first || connector.state.draggingExistingLinks) return;
            const at = e.detail.originalEvent;
            // 事件結束後 litegraph 會清掉連線狀態，所以先把需要的值複製出來
            this.openLinkPopup({
                node: first.node,
                slotIndex: first.fromSlotIndex,
                productId: String(first.fromSlot.type),
                towardInput: first.toType === "input",
                pos: [at.canvasX, at.canvasY],
            });
        };
        this.canvas.canvas.addEventListener("litegraph:canvas", this.onCanvasEvent);
    }

    stopListeningLinkRelease() {
        this.canvas.canvas.removeEventListener("litegraph:canvas", this.onCanvasEvent);
        this.closeLinkPopup();
    }

    /**
     * context：{ node, slotIndex, productId, towardInput, pos }。
     * towardInput 為 true 代表從輸出插槽拖出（要找吃這個物品的節點），false 代表從輸入插槽拖出（要找供應這個物品的節點）。
     */
    openLinkPopup(context) {
        // 背景統計值（空氣污染）不能連線，也沒有資源節點
        if (!this.productsById.has(context.productId)) return;
        this.showLinkPopup(context, this.linkCandidates(context.productId, context.towardInput));
    }

    linkCandidates(productId, towardInput) {
        const list = [];
        for (const t of this.typesById.values()) {
            const slot = (towardInput ? t.inputs : t.outputs).find(p => p.productId === productId);
            if (!slot) continue;
            list.push({
                category: t.machineCategory,
                title: `${t.machineName} · ${t.recipeName}`,
                perMinute: slot.perMinute,
                create: () => LiteGraph.createNode(typeName(t)),
            });
        }
        // 資源來源只有輸出：只有「找供應者」時才能用
        if (!towardInput) {
            const product = this.productsById.get(productId);
            list.push({
                category: SOURCE_CATEGORY,
                title: `資源 · ${product.name}`,
                perMinute: null,
                create: () => LiteGraph.createNode(sourceTypeName(product)),
            });
        }
        return list;
    }

    /** 在放開的位置新增節點，並接上原本拖曳的插槽。 */
    addLinkedNode(context, candidate) {
        const node = candidate.create();
        if (!node) return;
        const slots = context.towardInput ? node.inputs : node.outputs;
        const index = slots.findIndex(s => s.type === context.productId);
        this.graph.add(node);
        // 讓新節點上要接的那一行大約落在放開的位置：新節點在右邊（吃）或左邊（供應）
        const x = context.towardInput ? context.pos[0] + 2 * GRID_SIZE : context.pos[0] - node.size[0] - 2 * GRID_SIZE;
        node.pos = [x, context.pos[1] - (index + 0.7) * LiteGraph.NODE_SLOT_HEIGHT];
        node.snapToGrid(GRID_SIZE);
        if (context.towardInput)
            context.node.connect(context.slotIndex, node, index);
        else
            node.connect(index, context.node, context.slotIndex);
        this.canvas.selectNode(node);
        this.canvas.setDirty(true, true);
    }

    showLinkPopup(context, candidates) {
        this.closeLinkPopup();
        const product = this.productsById.get(context.productId);
        const el = (tag, className, text) => {
            const e = document.createElement(tag);
            if (className) e.className = className;
            if (text !== undefined) e.textContent = text;
            return e;
        };

        const overlay = el("div", "link-popup-overlay");
        // 用 pointerdown 關閉：放開連線的那一下 pointerup 之後還會有 click，不能被當成點了外面
        overlay.addEventListener("pointerdown", e => { if (e.target === overlay) this.closeLinkPopup(); });
        const dialog = el("div", "link-popup");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-label", "可連接的節點");

        const header = el("div", "link-popup-header");
        header.append(el("div", "link-popup-title", "可連接的節點"));
        header.append(el("div", "link-popup-subtitle", context.towardInput
            ? `「${context.node.title}」輸出的${product.name}，可以接到：`
            : `「${context.node.title}」需要的${product.name}，可以由這些節點供應：`));
        const search = el("input", "link-popup-search");
        search.type = "search";
        search.placeholder = "搜尋…";
        search.setAttribute("aria-label", "搜尋可連接的節點");
        header.append(search);

        const list = el("div", "link-popup-list");
        const rows = [];
        const categories = [...new Set(candidates.map(c => c.category))]
            .sort((a, b) => (a === SOURCE_CATEGORY) - (b === SOURCE_CATEGORY));
        for (const category of categories) {
            const heading = el("div", "link-popup-category", category);
            list.append(heading);
            const group = { heading, items: [] };
            for (const candidate of candidates.filter(c => c.category === category)) {
                const row = el("button", "link-popup-item");
                row.type = "button";
                row.append(el("span", "link-popup-item-title", candidate.title));
                if (candidate.perMinute != null)
                    row.append(el("span", "link-popup-item-rate", `${context.towardInput ? "消耗" : "產出"} ${formatRate(candidate.perMinute)}/分（每台）`));
                row.addEventListener("click", () => {
                    this.closeLinkPopup();
                    this.addLinkedNode(context, candidate);
                });
                list.append(row);
                group.items.push({ row, text: `${category} ${candidate.title}` });
                rows.push(row);
            }
            rows.groups = (rows.groups ?? []).concat(group);
        }
        const empty = el("div", "link-popup-empty", candidates.length ? "沒有符合的節點" : "沒有可以連接的節點");
        empty.hidden = candidates.length > 0;
        list.append(empty);

        // 搜尋：標題或分類包含輸入的文字（不分大小寫）；整組都被濾掉時一併隱藏分類標題
        search.addEventListener("input", () => {
            const q = search.value.trim().toLowerCase();
            let visible = 0;
            for (const group of rows.groups ?? []) {
                let any = false;
                for (const item of group.items) {
                    item.row.hidden = !item.text.toLowerCase().includes(q);
                    any ||= !item.row.hidden;
                }
                group.heading.hidden = !any;
                visible += group.items.filter(i => !i.row.hidden).length;
            }
            empty.hidden = visible > 0;
        });
        search.addEventListener("keydown", e => {
            if (e.key === "Enter") rows.find(r => !r.hidden)?.click();
        });

        const footer = el("div", "link-popup-footer");
        const close = el("button", "link-popup-close", "關閉（Esc）");
        close.type = "button";
        close.addEventListener("click", () => this.closeLinkPopup());
        footer.append(close);

        dialog.append(header, list, footer);
        overlay.append(dialog);
        this.onLinkPopupKey = e => { if (e.key === "Escape") this.closeLinkPopup(); };
        window.addEventListener("keydown", this.onLinkPopupKey, true);
        document.body.append(overlay);
        this.linkPopup = overlay;
        search.focus();
    }

    closeLinkPopup() {
        if (!this.linkPopup) return;
        this.linkPopup.remove();
        this.linkPopup = null;
        window.removeEventListener("keydown", this.onLinkPopupKey, true);
        this.canvas.canvas.focus({ preventScroll: true });
    }
}
