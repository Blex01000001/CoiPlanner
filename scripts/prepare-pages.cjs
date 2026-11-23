// 把 dotnet publish 產生的 wwwroot 整理成可放在 GitHub Pages 的內容。用法：
//   node scripts/prepare-pages.cjs <wwwroot 資料夾> --version <版本> [--base /CoiPlanner/]
// - 把版本號加到自己的 JS 模組匯入（./、../ 開頭）、index.html 的 CSS／JS 網址：
//   GitHub Pages 的檔案會被瀏覽器快取約 10 分鐘，網址不變就可能繼續用舊版；graphEditor 是多個 ES 模組，
//   子模組是用固定網址匯入的，所以在發佈的檔案裡統一加上版本號（原始檔不動）。
// - --base：把 index.html 的 <base href="/"> 換成網站所在的子路徑（專案頁面是 /儲存庫名稱/）。
// - 複製 index.html 成 404.html（直接開 /planner 這類網址時，GitHub Pages 回 404.html，Blazor 路由再接手）
//   並放 .nojekyll（否則 _framework 這類底線開頭的資料夾不會被提供）。
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const root = args[0];
const option = name => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
};
const version = option("version");
const base = option("base");
if (!root || !version || !fs.existsSync(path.join(root, "index.html"))) {
    console.error("用法：node scripts/prepare-pages.cjs <wwwroot 資料夾> --version <版本> [--base /子路徑/]");
    process.exit(1);
}

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else yield full;
    }
}

// JS 模組：from "./x.js" → from "./x.js?v=版本"
let moduleCount = 0;
for (const file of walk(path.join(root, "js"))) {
    if (!file.endsWith(".js")) continue;
    const text = fs.readFileSync(file, "utf8");
    const stamped = text.replace(/(from\s+")(\.{1,2}\/[^"?]+\.js)(")/g, (_, a, spec, c) => { moduleCount++; return `${a}${spec}?v=${version}${c}`; });
    if (stamped !== text) fs.writeFileSync(file, stamped);
}

// index.html：本站的 CSS／JS 網址加版本號，base 換成子路徑
const indexPath = path.join(root, "index.html");
let html = fs.readFileSync(indexPath, "utf8");
let assetCount = 0;
html = html.replace(/(href|src)="((?!https?:)[^"?]+\.(?:css|js))"/g, (_, attr, url) => { assetCount++; return `${attr}="${url}?v=${version}"`; });
if (base) {
    assert(/^\/.*\/$|^\/$/.test(base), `--base 必須以 / 開頭並以 / 結尾：${base}`);
    assert(html.includes('<base href="/" />'), "index.html 找不到 <base href=\"/\" />");
    html = html.replace('<base href="/" />', `<base href="${base}" />`);
}
fs.writeFileSync(indexPath, html);
fs.writeFileSync(path.join(root, "404.html"), html);
fs.writeFileSync(path.join(root, ".nojekyll"), "");

console.log(`完成：${moduleCount} 個模組匯入、${assetCount} 個 index.html 網址加上版本 ${version}${base ? `，base=${base}` : ""}`);

function assert(cond, message) {
    if (!cond) { console.error(message); process.exit(1); }
}
