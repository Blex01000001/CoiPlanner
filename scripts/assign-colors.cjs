// 幫還沒有 color 的物品自動補上顏色：和所有現有物品的顏色都不重複，彼此也盡量分得開。
// 用法：node scripts/assign-colors.cjs [資料夾，預設 Data]
// - 讀取資料夾內所有 *.json（允許 // 註解），找出 products 裡沒有 color 的物品，
//   直接在原檔案該物品那一行的結尾補上 "color": "#rrggbb"，其他內容與格式不動。
// - 物品必須寫成單行物件（{ "id": "...", ..., "kind": "..." }），這也是 Data/10-products.json 目前的寫法；不是單行時會報錯，不會亂改。
// - 顏色由固定的演算法產生（色相用黃金比例分散，飽和度與亮度輪替），同樣的輸入每次結果相同。
const fs = require("fs");
const path = require("path");

const dir = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "Data"));
const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort().map(f => path.join(dir, f));
if (!files.length) fail(`${dir} 沒有 *.json`);

const parse = text => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
const texts = new Map(files.map(f => [f, fs.readFileSync(f, "utf8")]));
const missing = [];   // { file, id }
const used = [];      // 現有的顏色（#rrggbb，小寫）
for (const [file, text] of texts) {
    let data;
    try { data = parse(text); } catch (e) { fail(`${path.basename(file)} 不是合法的 JSON：${e.message}`); }
    for (const p of data.products ?? []) {
        if (p.color) used.push(p.color.toLowerCase());
        else missing.push({ file, id: p.id });
    }
}
if (!missing.length) {
    console.log("所有物品都有 color，不用補。");
    process.exit(0);
}

const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const distance2 = (a, b) => rgb(a).reduce((sum, x, i) => sum + (x - rgb(b)[i]) ** 2, 0);
let step = used.length * 7 + 1;   // 從現有數量決定起點，避免總是從同一個色相開始
const assigned = new Map();
for (const { id } of missing) {
    let min = 20;
    let color = null;
    for (let attempt = 1; attempt <= 6000 && !color; attempt++, step++) {
        const h = (step * 0.61803398875) % 1;
        const s = 0.35 + 0.55 * (((step * 7) % 11) / 10);
        const l = 0.32 + 0.43 * (((step * 5) % 13) / 12);
        const c = hslToHex(h, s, l);
        if (used.includes(c)) continue;
        if (used.every(u => distance2(c, u) >= min * min)) color = c;
        else if (attempt % 1500 === 0) min = Math.max(4, min - 4);   // 顏色太擠時放寬距離，絕不無限迴圈
    }
    if (!color) fail(`找不到可用的顏色給 ${id}`);
    used.push(color);
    assigned.set(id, color);
}

for (const [file, text] of texts) {
    let changed = text;
    for (const { file: f, id } of missing.filter(m => m.file === file)) {
        const line = new RegExp(`^(\\s*\\{ "id": "${id}",[^\\n]*?)( \\},?)$`, "m");
        if (!line.test(changed)) fail(`${path.basename(file)} 的物品 ${id} 不是單行物件，請手動加上 color`);
        changed = changed.replace(line, `$1, "color": "${assigned.get(id)}"$2`);
    }
    if (changed !== text) fs.writeFileSync(file, changed);
}
for (const [id, color] of assigned) console.log(`${id}: ${color}`);
console.log(`補上 ${assigned.size} 個顏色。`);

function hslToHex(h, s, l) {
    const f = n => {
        const k = (n + h * 12) % 12;
        const a = s * Math.min(l, 1 - l);
        return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return "#" + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, "0")).join("");
}

function fail(message) {
    console.error(message);
    process.exit(1);
}
