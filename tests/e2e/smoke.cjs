// 瀏覽器冒煙測試：啟動已建置的網站，用 Playwright 實際操作主要功能，結束後關閉網站。
// 用法（先 dotnet build）：node tests/e2e/smoke.cjs
//   BASE_URL=http://localhost:5062 node tests/e2e/smoke.cjs   改測已在執行的網站（不自動啟動）
//   HEADED=1 node tests/e2e/smoke.cjs                          顯示瀏覽器視窗
// 失敗時印出步驟名稱，截圖存到 tests/e2e/.output/。
//
// 畫面座標的前提：新開的頁面視野是 1:1、原點在左上，節點畫在 fixtures 指定的座標（標題列在 y-30～y）。
// 避開下方中央：那裡是提示訊息。
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const FIXTURES = path.join(__dirname, "fixtures");
const OUTPUT = path.join(__dirname, ".output");
const PORT = 5170;
const BASE = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const VIEWPORT = { width: 1400, height: 800 };
const STORAGE_KEY = "coiplanner.plan";
const TITLE_HEIGHT = 30;
const GRID = 20;

const errors = [];
let server;
let page;

async function main() {
    if (!process.env.BASE_URL) server = await startServer();
    const browser = await chromium.launch({ headless: !process.env.HEADED });
    try {
        page = await newPage(browser);

        await step("/js/ 以 no-cache 提供（模組更新後瀏覽器不會用舊版）", async () => {
            for (const file of ["graphEditor.js", "graphEditor/editor.js"]) {
                const res = await fetch(`${BASE}/js/${file}`);
                const cache = res.headers.get("cache-control");
                assert(res.ok && cache?.includes("no-cache"), `/js/${file}：${res.status}，cache-control=${cache}`);
            }
        });

        await step("資料瀏覽：各分頁可切換且沒有錯誤", async () => {
            await page.goto(BASE);
            await page.waitForSelector(".mud-tab");
            for (const tab of await page.locator(".mud-tab").all()) await tab.click();
            const tabs = await page.locator(".mud-tab").allInnerTexts();
            assert(tabs.some(t => t.startsWith("運輸")), `分頁：${tabs.join(", ")}`);
            assert(!(await page.locator("#blazor-error-ui").isVisible()), "出現 Blazor 錯誤列");
        });

        await step("產線規劃：開頁時面板收起，用按鈕匯入", async () => {
            await openPlanner();
            assert((await page.locator(".planner-side:not(.d-none)").count()) === 0, "面板預設應收起");
            await importWithButton("basic.json");
            const plan = await savedPlan();
            assert(plan.nodes.length === 3 && plan.edges.length === 2, `節點 ${plan.nodes.length}、連線 ${plan.edges.length}`);
        });

        await step("右鍵選單是中文且只有需要的項目", async () => {
            assertEqual(await menuAt(900, 450), ["新增節點", "新增註解", "新增群組"], "畫布選單");
            assertEqual(await menuAt(130, 245), ["複製", "刪除"], "節點選單");
            assertEqual(await menuAt(450, 154), ["中斷連線"], "插槽選單");
        });

        await step("複製節點會帶上機器數量", async () => {
            await menuAt(130, 245);
            await clickMenu("複製");
            const counts = (await savedPlan(p => p.nodes.length === 4)).nodes
                .filter(n => n.machineId === "coal_mine").map(n => n.count);
            assertEqual(counts, [2, 2], "煤礦場數量");
        });

        await step("插槽選單可中斷連線", async () => {
            await menuAt(450, 154);
            await clickMenu("中斷連線");
            await savedPlan(p => p.edges.length === 1);
        });

        await step("點連線中間的標籤可改運輸等級", async () => {
            // 煤礦場輸出 (300, 274) → 鍋爐煤礦輸入 (440, 174)，標籤在曲線中點
            const items = await menuAt(370, 224, "left");
            assertEqual(items, ["✓ 1 級（60/分）", "2 級（120/分）", "3 級（220/分）", "4 級（400/分）", "刪除連線"], "連線選單");
            await clickMenu("2 級");
            const edge = (await savedPlan(p => p.edges[0]?.tier === 2)).edges[0];
            assertEqual([edge.productId, edge.transport], ["coal", "loose_belt"], "連線");
        });

        await step("按住 Shift 拖動節點會對齊格線", async () => {
            await page.keyboard.down("Shift");
            await drag([130, 85], [167, 113]);
            await page.keyboard.up("Shift");
            const pump = (await savedPlan(p => p.nodes.find(n => n.id === "1").x !== 40)).nodes.find(n => n.id === "1");
            assert(pump.x % GRID === 0 && (pump.y - TITLE_HEIGHT) % GRID === 0, `位置 ${pump.x},${pump.y}`);
        });

        await step("新增註解與群組，重新整理後仍在", async () => {
            await menuAt(900, 450);
            await clickMenu("新增註解");
            await page.fill(".graphdialog textarea", "第一行\n第二行");
            await page.click(".graphdialog button");
            await page.mouse.click(900, 560);
            await page.keyboard.press("Control+a");
            // 右鍵要點在空白處：(900, 450) 已經放了註解
            const groupItem = (await menuAt(700, 520)).find(t => t.startsWith("新增群組（框住選取"));
            assert(groupItem, "全選後畫布選單沒有「新增群組（框住選取…）」");
            await clickMenu(groupItem);
            await page.fill(".graphdialog input", "能源區");
            await page.click(".graphdialog button");
            await savedPlan(p => p.notes.length === 1 && p.groups[0]?.title === "能源區");

            await page.reload();
            await page.waitForTimeout(2500);
            const plan = await savedPlan();
            assertEqual(plan.notes.map(n => n.text), ["第一行\n第二行"], "註解內容");
            assertEqual(plan.groups.map(g => g.title), ["能源區"], "群組名稱");
        });

        await step("註解與群組的選單：重新命名、換色、刪除群組", async () => {
            assertEqual(await menuAt(1000, 520), ["編輯內容", "重新命名", "顏色", "複製", "刪除"], "註解選單");
            await clickMenu("重新命名");
            await page.fill(".graphdialog input", "待辦");
            await page.click(".graphdialog button");
            await savedPlan(p => p.notes[0]?.title === "待辦");

            await menuAt(1000, 520);
            await clickMenu("顏色");
            await clickMenu("黃");
            await savedPlan(p => p.notes[0]?.color === "yellow");

            // (700, 520) 在群組內、不在任何節點上
            const items = await menuAt(700, 520);
            assertEqual(items.slice(3), ["重新命名群組「能源區」", "群組顏色", "刪除群組（保留裡面的節點）"], "群組選單");
            await clickMenu("群組顏色");
            await clickMenu("綠");
            await savedPlan(p => p.groups[0]?.color === "#8A8");

            await menuAt(700, 520);
            await clickMenu("刪除群組");
            const plan = await savedPlan(p => p.groups.length === 0);
            assert(plan.nodes.length === 4 && plan.notes.length === 1, "刪除群組時裡面的節點與註解要保留");
        });

        await step("拖放匯入，模擬到穩定後機械零件每分鐘 48", async () => {
            await dropFile("steel.json");
            await page.click(".planner-sim-bar >> text=20×");
            await waitForClock(180);
            await page.click('[aria-label="物料平衡面板"]');
            const parts = await balanceOf("機械零件");
            assert(Math.abs(parts.supply - 48) < 0.5, `機械零件產出 ${parts.supply}`);
            await page.click('[aria-label="物料平衡面板"]');
        });

        await step("兩個來源合流到同一個輸入，兩條連線都保留且都有流量", async () => {
            await dropFile("merge.json");
            const plan = await savedPlan(p => p.edges.length === 3);
            const coal = plan.edges.filter(e => e.productId === "coal");
            assert(coal.length === 2 && coal[0].targetNodeId === coal[1].targetNodeId
                && coal[0].sourceNodeId !== coal[1].sourceNodeId, `煤礦連線：${JSON.stringify(coal)}`);
            await page.click(".planner-sim-bar >> text=20×");
            await waitForClock(120);
            await page.click('[aria-label="物料平衡面板"]');
            const coalBalance = await balanceOf("煤礦");
            assert(Math.abs(coalBalance.demand - 20) < 0.5, `煤礦消耗 ${coalBalance.demand}（兩條都有流量應為 20）`);
            await page.click('[aria-label="物料平衡面板"]');
        });

        await step("Fit view 按鈕可用，沒有瀏覽器錯誤", async () => {
            const before = errors.length;
            await page.click('[aria-label="Fit view"]');
            await page.waitForTimeout(600);
            assert(errors.length === before, `按下 Fit view 後出現錯誤：${errors.slice(before).join("; ")}`);
        });

        await step("暫停時時間不動，重置回到 00:00", async () => {
            await page.click('[aria-label="暫停"]');
            // 時間每 300 ms 才更新一次顯示，等它反映暫停當下的時間
            await page.waitForTimeout(800);
            const before = await clockText();
            await page.waitForTimeout(1000);
            assertEqual(await clockText(), before, "暫停後的時間");
            await page.click('[aria-label="重置模擬"]');
            await page.waitForTimeout(500);
            assertEqual(await clockText(), "00:00", "重置後的時間");
        });

        await step("匯出下載規劃檔，內容與目前規劃一致", async () => {
            await closePanels();
            await page.click('[aria-label="產線規劃面板"]');
            const [download] = await Promise.all([
                page.waitForEvent("download"),
                page.click('.planner-side:not(.d-none) button:has-text("匯出")'),
            ]);
            assert(/^coiplanner-plan-\d{8}-\d{4}\.json$/.test(download.suggestedFilename()), `檔名 ${download.suggestedFilename()}`);
            const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
            const saved = await savedPlan();
            const counts = p => [p.nodes.length, p.sources.length, p.edges.length];
            assertEqual(counts(exported), counts(saved), "匯出與自動存檔的節點／資源／連線數");
        });

        await step("問題清單：有問題的連線會列出錯誤，沒問題時顯示「沒有問題」", async () => {
            await closePanels();
            await dropFile("issue.json");
            await page.click('[aria-label="產線規劃面板"]');
            await page.waitForSelector(".planner-side:not(.d-none) .mud-alert");
            const alerts = await page.locator(".planner-side:not(.d-none) .mud-alert").allInnerTexts();
            assert(alerts.length === 1 && alerts[0].includes("沒有 9 級"), `錯誤清單：${JSON.stringify(alerts)}`);

            await dropFile("basic.json");
            await page.waitForSelector(".planner-side:not(.d-none) .mud-alert", { state: "detached" });
            assert((await page.locator(".planner-side:not(.d-none)").innerText()).includes("沒有問題。"), "沒有顯示「沒有問題。」");
        });

        await step("速度按鈕：選中的速度反白，模擬速度跟著變", async () => {
            await closePanels();
            const bar = page.locator(".planner-sim-bar");
            // 前一步把模擬暫停了，先繼續播放
            if (await bar.locator('[aria-label="播放"]').count()) await bar.locator('[aria-label="播放"]').click();
            for (const speed of ["1×", "5×", "10×", "20×"]) {
                await bar.locator(`button:has-text("${speed}")`).click();
                const filled = await eventually(
                    async () => (await bar.locator("button.mud-button-filled:not(.mud-icon-button)").allInnerTexts()).map(t => t.trim()),
                    v => v.length === 1 && v[0] === speed);
                assertEqual(filled, [speed], "反白的速度按鈕");
            }
            const simSeconds = async () => { const [m, s] = (await clockText()).split(":").map(Number); return m * 60 + s; };
            const rate = async speed => {
                await bar.locator(`button:has-text("${speed}")`).click();
                // 時間顯示每 300 ms 才更新，等它反映新的速度再開始量
                await page.waitForTimeout(800);
                const t0 = await simSeconds();
                await page.waitForTimeout(2000);
                return (await simSeconds() - t0) / 2;
            };
            const slow = await rate("1×");
            const fast = await rate("10×");
            assert(slow > 0.5 && slow < 1.6 && fast > 6 && fast < 14, `每秒模擬秒數：1× ${slow}、10× ${fast}`);
        });

        await step("清空：取消不會動到規劃，確認才會清掉", async () => {
            await closePanels();
            const before = await savedPlan();
            assert(before.nodes.length > 0, "測試前提：目前要有內容可清");
            await page.click('[aria-label="產線規劃面板"]');
            await page.click('.planner-side:not(.d-none) button:has-text("清空")');
            await page.click('.mud-dialog button:has-text("取消")');
            await page.waitForSelector(".mud-dialog", { state: "detached" });
            assertEqual((await savedPlan()).nodes.length, before.nodes.length, "取消後的節點數");

            await page.click('.planner-side:not(.d-none) button:has-text("清空")');
            await page.click('.mud-dialog button:has-text("清空")');
            const plan = await savedPlan(p => p.nodes.length === 0);
            assertEqual([plan.nodes.length, plan.sources.length, plan.edges.length, plan.groups.length, plan.notes.length], [0, 0, 0, 0, 0], "清空後");
            assert(await page.locator('.planner-side:not(.d-none) button:has-text("清空")').isDisabled(), "沒有內容時「清空」應停用");
        });

        await step("顯示比例 125% 時畫布解析度跟著放大", async () => {
            const scaled = await newPage(browser, 1.25);
            await scaled.goto(`${BASE}/planner`);
            await scaled.waitForTimeout(2500);
            const [w, h, cssW] = await scaled.evaluate(() => {
                const c = document.querySelector(".planner canvas");
                return [c.width, c.height, c.clientWidth];
            });
            assert(w === Math.round(cssW * 1.25) && h > 0, `canvas ${w}x${h}，CSS 寬 ${cssW}`);
            await scaled.close();
        });

        assert(errors.length === 0, `瀏覽器錯誤：\n${errors.join("\n")}`);
        console.log("\n全部通過");
    } finally {
        await browser.close();
        await stopServer();
    }
}

// ---- 步驟與斷言 ----

async function step(name, fn) {
    try {
        await fn();
        console.log(`✔ ${name}`);
    } catch (err) {
        fs.mkdirSync(OUTPUT, { recursive: true });
        const shot = path.join(OUTPUT, "failure.png");
        await page?.screenshot({ path: shot }).catch(() => { });
        console.error(`✘ ${name}\n  ${err.message}\n  截圖：${shot}`);
        throw new Error("冒煙測試失敗");
    }
}

function assert(ok, message) {
    if (!ok) throw new Error(message);
}

function assertEqual(actual, expected, what) {
    assert(JSON.stringify(actual) === JSON.stringify(expected),
        `${what}：預期 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`);
}

// ---- 頁面操作 ----

async function newPage(browser, deviceScaleFactor = 1) {
    const p = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor });
    p.on("pageerror", e => errors.push(e.message));
    p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    return p;
}

async function openPlanner() {
    await page.goto(`${BASE}/planner`);
    await page.waitForSelector(".planner-sim-bar");
    await page.waitForTimeout(2000);
}

async function importWithButton(fixture) {
    await page.click('[aria-label="產線規劃面板"]');
    const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.click('.planner-side button:has-text("匯入")'),
    ]);
    await chooser.setFiles(path.join(FIXTURES, fixture));
    await page.waitForTimeout(800);
    await page.click('[aria-label="產線規劃面板"]');
}

async function dropFile(fixture) {
    const text = fs.readFileSync(path.join(FIXTURES, fixture), "utf8");
    await page.evaluate(([name, content]) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], name));
        document.querySelector(".planner").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [fixture, text]);
    await page.waitForTimeout(800);
}

/** 在畫布座標按右鍵（連線中間的標籤是按左鍵），回傳選單項目文字。 */
async function menuAt(x, y, button = "right") {
    await page.keyboard.press("Escape");
    await page.mouse.click(x, y, { button });
    await page.waitForSelector(".litecontextmenu");
    return (await page.locator(".litecontextmenu .litemenu-entry").allInnerTexts()).map(t => t.trim()).filter(Boolean);
}

async function clickMenu(text) {
    await page.locator(".litecontextmenu .litemenu-entry", { hasText: text }).first().click();
    await page.waitForTimeout(300);
}

async function drag([x1, y1], [x2, y2]) {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 8 });
    await page.mouse.up();
}

/** 讀自動存檔；給了條件時等到條件成立（畫布的修改會延遲一下才存）。 */
async function savedPlan(until = () => true, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    for (; ;) {
        const plan = JSON.parse(await page.evaluate(k => localStorage.getItem(k), STORAGE_KEY) ?? "null");
        if (plan && until(plan)) return plan;
        if (Date.now() > deadline) throw new Error(`自動存檔沒有達到預期狀態：${JSON.stringify(plan)?.slice(0, 300)}`);
        await page.waitForTimeout(100);
    }
}

/** 重複讀取直到條件成立（畫面更新有延遲）；逾時就回傳最後一次的值，讓呼叫端用斷言報出實際內容。 */
async function eventually(read, ok, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    for (; ;) {
        const value = await read();
        if (ok(value) || Date.now() > deadline) return value;
        await page.waitForTimeout(100);
    }
}

/** 關掉開著的側邊面板（一次只會開一個），並等它真的消失。 */
async function closePanels() {
    const open = page.locator(".planner-side:not(.d-none)");
    if ((await open.count()) === 0) return;
    // 滑鼠移開：剛按過的側邊按鈕會顯示提示文字，蓋在關閉鈕上面
    await page.mouse.move(700, 700);
    await page.waitForTimeout(500);
    await open.locator('[aria-label="收合面板"]').click();
    await page.waitForSelector(".planner-side:not(.d-none)", { state: "detached" });
}

async function clockText() {
    return (await page.locator(".planner-sim-clock").innerText()).trim();
}

async function waitForClock(seconds, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    for (; ;) {
        const [m, s] = (await clockText()).split(":").map(Number);
        if (m * 60 + s >= seconds) return;
        if (Date.now() > deadline) throw new Error(`模擬時間沒有到 ${seconds} 秒`);
        await page.waitForTimeout(250);
    }
}

async function balanceOf(productName) {
    await page.waitForSelector(".planner-side:not(.d-none) tbody tr");
    for (const row of await page.locator(".planner-side:not(.d-none) tbody tr").all()) {
        const cells = (await row.locator("td").allInnerTexts()).map(t => t.trim());
        if (cells[0] === productName) return { supply: Number(cells[1]), demand: Number(cells[2]) };
    }
    throw new Error(`物料平衡表沒有「${productName}」`);
}

// ---- 網站 ----

async function startServer() {
    // 上一次的網站還沒結束時會測到舊版本，直接報錯
    const busy = await fetch(BASE).then(() => true, () => false);
    assert(!busy, `${BASE} 已經有網站在執行；等它結束，或用 BASE_URL 指定要測的網站`);
    const dll = path.join(ROOT, "bin/Debug/net8.0/CoiPlanner.dll");
    assert(fs.existsSync(dll), "找不到 bin/Debug/net8.0/CoiPlanner.dll，請先執行 dotnet build");
    const proc = spawn("dotnet", [dll, "--urls", BASE], {
        cwd: ROOT,
        env: { ...process.env, ASPNETCORE_ENVIRONMENT: "Development" },
        stdio: "ignore",
    });
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(BASE)).ok) return proc;
        } catch { /* 還沒啟動 */ }
        await new Promise(r => setTimeout(r, 500));
    }
    proc.kill();
    throw new Error(`網站 60 秒內沒有在 ${BASE} 啟動`);
}

// 不論怎麼結束（包含輸出被 head 之類的指令截斷而中途退出），都要把網站關掉，否則下次會因為埠被佔用而無法執行
process.on("exit", () => server?.kill());

/** 關閉網站並等它真的結束（ASP.NET 收到 SIGTERM 後會花幾秒正常關閉），下一次執行才不會撞到同一個連接埠。 */
async function stopServer() {
    if (!server || server.exitCode !== null) return;
    const exited = new Promise(r => server.once("exit", r));
    server.kill();
    const timeout = new Promise(r => setTimeout(() => r("timeout"), 10000));
    if (await Promise.race([exited, timeout]) === "timeout") server.kill("SIGKILL");
}

main().catch(async err => {
    console.error(err.message);
    await stopServer();
    process.exit(1);
});
