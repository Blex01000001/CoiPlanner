# CoiPlanner：Captain of Industry 產線規劃工具

Blazor WebAssembly 獨立版（.NET 8，靜態網站、沒有伺服器，程式整個在瀏覽器執行）＋ MudBlazor 的產線規劃與模擬工具。不連線遊戲，資料來自 `Data/*.json`；規劃畫面是 ComfyUI 風格節點編輯器（@comfyorg/litegraph）。
**JS 只負責畫面，計算一律在 C# `Domain/`（不依賴 UI，附 xUnit 測試）。** 細節以程式碼與檔案開頭註解為準。

## 檔案地圖
| 檔案 | 負責 | 常見修改 |
|---|---|---|
| `Data/game.json` | 物品（含運輸型態 `kind`）、配方、機器、運輸方式。建置時全部 `Data/*.json` 編進組件，啟動時 `GameDataLoader.LoadFromAssembly` 載入並驗證，有錯網站無法啟動；**改了資料要重新建置** | 新增／刪除機器、配方、物品 |
| `Domain/Models/` | 領域模型。`ProductionPlan.cs`＝規劃檔格式；`Simulation.cs`＝模擬參數與狀態 | 加欄位 |
| `Domain/Services/PlanCalculator.cs` | 規劃檢查（問題清單）、額定速率、連線運輸上限；**不算實際流量** | 新增檢查規則 |
| `Domain/Services/RecipeCostCalculator.cs` | 配方成本比較：選一個物品，列出能產出它的每個配方，展開到原料，算每 1 單位的原料（加權）、副產品，以及維持 1 單位/分的耗電、工人、維修。原料權重與指定的中間物品做法由使用者設定（存在瀏覽器 `coiplanner.costWeights`、`coiplanner.costRecipes`，不屬於規劃檔） | 成本規則 |
| `Domain/Services/ProductionSimulator.cs` | 逐步模擬：實際流量、稼動率、狀態、物料平衡 | 模擬行為 |
| `Domain/Services/GameDataLoader.cs` | 載入與跨檔驗證遊戲資料 | 新資料欄位的驗證 |
| `Domain/Services/ProductionPlanSerializer.cs`、`JsonDefaults.cs` | 規劃 JSON（camelCase、允許註解與尾逗號） | 很少改 |
| `Components/Pages/Planner.razor`、`Planner.razor.cs` | 產線規劃頁：`.razor` 只有版面，`.razor.cs` 是 interop、模擬迴圈、面板切換、匯入匯出、自動存檔；**所有狀態都在這裡** | 流程、新的狀態或呼叫 |
| `Components/Planning/` | 規劃頁的畫面元件，只顯示並回報操作：`SimulationBar` 模擬控制列、`PlanPanel` 規劃面板（說明、匯出入、問題）、`BalancePanel` 物料平衡 | 面板與控制項的外觀 |
| `wwwroot/js/graphEditor.js`（入口）、`wwwroot/js/graphEditor/` | litegraph 包裝，拆成 ES 模組（模組表與覆寫清單在入口檔開頭）：`nodes.js` 節點類型、`plan.js` 存檔／載入、`status.js` 狀態與顏色、`colors.js` 物品顏色（連線、插槽、節點）、`stock.js` 暫存長條、`flow.js` 連線外觀、`viewport.js` 格線與 fit view、`menus.js` 選單與其動作、`linkPopup.js` 拖出連線放在空白處的跳窗（列出可接的節點、點選後新增並連線）、`editor.js` 核心與對 litegraph 的覆寫、`shared.js` 共用 | 畫布外觀與互動 |
| `Components/Pages/Home.razor` | 資料瀏覽（物品、配方、機器、運輸），路徑 `/data` | 顯示新資料欄位 |
| `Components/Pages/Cost.razor` | 配方成本頁（`/cost`，整頁滿版）：選物品、原料權重、指定中間物品做法、比較表；狀態都在這個頁面，選擇的物品、權重與指定的做法存瀏覽器 | 成本表的外觀與欄位 |
| `Components/Layout/MainLayout.razor` | 無 App Bar，左側三顆浮動換頁按鈕（產線規劃、資料瀏覽、配方成本）。起始頁 `/` 是產線規劃（`/planner` 也可），資料瀏覽是 `/data`，配方成本是 `/cost` | 很少改 |
| `wwwroot/index.html`、`favicon.svg`／`favicon.png`／`apple-touch-icon.png` | 網頁骨架：`<head>`、CSS、啟動 Blazor 的 script、頁籤圖示（PNG 由 SVG 產生） | 新增 CSS |
| `Program.cs` | WebAssembly 啟動、DI、提示訊息位置、載入遊戲資料 | 很少改 |
| `wwwroot/app.css` | 版面：畫布滿版、浮動元件位置 | 位置與樣式 |
| `wwwroot/lib/litegraph/` | 第三方 litegraph 0.17.2；搜尋預設略過（`.ignore`），查內部實作時明確指定路徑 | **不可修改** |
| `scripts/assign-colors.cjs`、`scripts/prepare-pages.cjs` | 幫沒有 `color` 的物品自動配色；發佈後整理成 GitHub Pages 內容 | 很少改 |
| `tsconfig.check.json` | 上面 `tsc` 檢查用的設定（只找名稱與匯出，型別錯誤是雜訊） | 很少改 |
| `tests/e2e/smoke.cjs`、`tests/e2e/fixtures/` | 瀏覽器冒煙測試與測試用規劃檔（使用實際的機器 id） | 新增畫面功能時補步驟 |
| `tests/CoiPlanner.Domain.Tests/` | xUnit。虛構測試資料只在 `Fixtures/sample.json`（`TestData.Sample` 由它載入）；`RealGameDataTests.cs` 檢查實際的 `Data/game.json` | 每次改 Domain 或資料都補 |
| `NAMES.md` | 名稱對照表：同義名稱（別名→正式名稱）、名稱相近但不同的物品、名稱寫法規則。`NameMapTests` 會檢查它和 `Data/game.json` 一致 | 使用者貼資料出現別名、確認同義關係時 |
| `README.md` | 專案說明、執行方式、專案結構 | 結構或執行方式改變時 |
| `PROGRESS.md` | 已知限制與待辦（更新規則見下方「PROGRESS.md」） | 需要時才讀 |

## 修改後的驗證
```bash
dotnet build    # 乾淨建置約 30 秒；改 C#／Razor 後必跑
dotnet test     # 約 10 秒（含增量建置）；每次 commit 前必跑
dotnet test --no-build --filter "FullyQualifiedName~ProductionSimulatorTests"   # 只跑一個類別，約 2 秒
```
```bash
for f in wwwroot/js/graphEditor.js wwwroot/js/graphEditor/*.js; do node --check "$f" || break; done   # 改 JS 後必跑（1 秒）；只查語法
tsc -p tsconfig.check.json | grep -E "^wwwroot/js/.*TS(2304|2305|2307|2459|2460|2614|2724|2552)"   # 改 JS 後必跑（2 秒）；列出找不到的名稱或匯出，沒有輸出＝沒問題（需要 tsc，雲端容器內建）
node tests/e2e/smoke.cjs                  # 瀏覽器冒煙測試，約 2 分鐘；改 JS／Razor／CSS 後、commit 前必跑（需先 dotnet build）
# 部署用的是 Release（有裁剪）；改動可能受影響時（JSON 序列化、反射）另跑：dotnet build -c Release && CONFIG=Release node tests/e2e/smoke.cjs
```
- 冒煙測試先 `dotnet publish --no-build` 到 `tests/e2e/.output/site`、跑 `scripts/prepare-pages.cjs`（和部署相同的整理），再用內建的 Node 靜態伺服器在 5170 埠提供（和 GitHub Pages 一樣只是檔案）；失敗時印出步驟並截圖到 `tests/e2e/.output/`。新增畫面功能時在 `smoke.cjs` 補一個 `step`。
- **測試全過才 commit，不可為了通過而跳過或刪除測試。**
- 第一次在雲端容器：沒有 `dotnet` 時執行 `apt-get install -y dotnet-sdk-8.0`（約 1 分鐘）。

## `Data/game.json` 欄位（細節以 `Domain/Models/` 的註解為準）
- **物品**：`id`、`name`、`unit`、`kind`（運輸型態）、`color`；`background: true`＝背景統計值（如空氣污染）。
- **配方**：`id`、`name`、`inputs`、`outputs`、`cycleSeconds`（一律 60）；選填 `powerMultiplier`（耗電倍率，預設 1）、`locked`（未解鎖，只顯示用）。
- **機器**：`id`、`name`、`category`（右鍵選單第一層分類）、`recipeIds`；選填 `powerUseKw`、`powerGenerationKw`、`workers`、`maintenanceType`＋`maintenancePerMinute`、`computingTf`（只記錄）。
- **運輸方式**：`id`、`name`、`kind`、`tiersPerMinute`（各等級每分鐘吞吐量）。

## 常見任務
1. **新增／刪除機器、配方、物品**：只改 `Data/game.json`。**使用者貼的資料出現不確定的名稱時，先查 `NAMES.md`**（別名要換成正式名稱，不要新增物品；沒列在表裡又有疑義就停下來問，確認後把結果加進表）。名稱要符合 `NAMES.md` 第 3 節的寫法規則（污、蒸汽、羅馬數字前加空格，測試會檢查）。配方一律 `cycleSeconds: 60`，`quantity` 即每分鐘量；新物品必須有 `kind`（且該型態要有運輸方式）與 `color`（新物品可以先不寫，寫完後跑 `node scripts/assign-colors.cjs` 自動補上不重複的顏色；背景統計值如空氣污染改設 `"background": true`，不要 `kind`，不能連線也沒有資源來源節點，只出現在物料平衡面板）（`#rrggbb`，連線與節點的顏色，不與其他物品重複）。`RealGameDataTests` 會檢查每個配方都有機器執行、每個物品都出現在配方中；新增重要配方時可補抽查值。刪除的機器在舊存檔中會於載入時略過並提示（`ReportDropped`）；`tests/e2e/fixtures/` 用到的話一起改。
2. **規劃檔加欄位**：`ProductionPlan.cs`（給預設值，舊檔才能載入）→ `graphEditor/plan.js` 的 `snapshot()` 與 `load()` → `ProductionPlanSerializerTests` 補往返測試。
3. **新增規劃檢查**：`PlanCalculator`；問題要帶 `NodeId` 或 `EdgeIndex`，畫布才會標紅。補 `PlanCalculatorTests`。
4. **改模擬行為**：`ProductionSimulator`／`SimulationSettings`，補 `ProductionSimulatorTests`；畫面只改 `graphEditor/status.js` 的 `applySimulation`、`statusOf`。
5. **畫布互動、選單**：`graphEditor/` 內對應的模組（新方法放進 `plan／status／stock／flow／viewport／menus／linkPopup.js` 的類別，名稱不可與其他模組重複），用節點子類或 canvas 實例覆寫，不改 lib（覆寫清單見 `graphEditor.js` 開頭）。
6. **新增 JS→C# 呼叫**：C# 方法加 `[JSInvokable]`，JS 用 `dotnetRef.invokeMethodAsync`。

## 架構決策（不要改回去）
- **不修改 `wwwroot/lib/litegraph/`**：檔案原樣複製自 npm，才能直接升級；行為差異全在 `graphEditor/` 覆寫。
- 插槽數固定為配方數；同一輸入的第二條以後連線接到疊在原插槽上的隱藏合流插槽（`mergeSlotFor`、`syncInputSlots`）。原因：使用者要求插槽數固定，而 litegraph 一個輸入只能接一條線。
- 運輸方式由物品 `kind` 決定（一種型態只走一種運輸），使用者只選等級；`Edge.Transport` 仍存檔，供 C# 檢查。
- `PlanCalculator` 只做檢查與額定值，實際數字一律來自 `ProductionSimulator`。原因：使用者選擇「只做模擬」。
- 模擬規則皆為使用者決定：連續流量、依連線建立順序填滿、沒接線的輸入＝0（停擺）、沒接線的輸出送進倉庫。`SimulationSettings` 預設值（暫存每台 1/3 分鐘向上取整、運送 0.5 秒、啟動 0.5 秒）是使用者暫訂，**改動前先問**。
- 模擬在 C# 以 100 ms 計時器推進、推給 JS；面板每 `PanelRefreshTicks` 次才重繪。原因：減少面板重繪，瀏覽器端的計算量也不浪費在面板上。
- 靜態網站，部署在 GitHub Pages（`.github/workflows/deploy.yml`：推到 `feature/domain-model` 時 `dotnet test` → `dotnet publish` → `scripts/prepare-pages.cjs` → 部署）。原因：使用者只有自己用，不想再開 Visual Studio 或維護伺服器。
- 瀏覽器快取靠版本號：Pages 的檔案會被快取約 10 分鐘，而 `graphEditor` 是多個 ES 模組、子模組網址是固定的，所以 `prepare-pages.cjs` 在**發佈的檔案**裡把版本號（commit SHA）加到模組匯入與 `index.html` 的 CSS／JS 網址，入口模組由 `Planner.razor.cs` 用組件的 `InformationalVersion`（部署時設成 SHA）當版本。原始檔不要手動加版本號；新增 JS 匯入時沿用 `from "./x.js"`／`"../x.js"` 的寫法（腳本只認這個格式）。
- 網站在子路徑 `/CoiPlanner/` 下：`index.html` 的 `<base href="/">` 只在發佈時換成子路徑，原始檔維持 `/`（本機開發用）；網址一律用相對路徑，不寫開頭的 `/`。`404.html`（複製自 `index.html`）讓直接開 `/planner` 這類網址時由 Blazor 路由接手。
- `Editor` 的方法分散在 `plan／status／stock／flow／viewport／menus／linkPopup.js` 的類別，由 `editor.js` 的 `mixin()` 併入 `Editor.prototype`；那些類別只是方法容器，不可 `new`。原因：JS 沒有 partial class，這樣才能拆檔而不改方法內容。
- 畫布像素＝CSS 大小 × `devicePixelRatio`，並對前景 ctx `setTransform`（`fitCanvas`）。原因：Windows 顯示比例 125%／150% 時畫面模糊且只畫一部分。
- 格線在 `onRenderBackground` 畫，不用 `onDrawBackground`。原因：後者會蓋掉群組。格線間距＝Shift 對齊間距 `GRID_SIZE`，對齊以含標題的外框為準。
- Shift 在 `window` 追蹤並切換 `LiteGraph.alwaysSnapToGrid`。原因：litegraph 只在 canvas 有焦點時才知道 Shift。
- 保留拖放 .json 匯入（`OnFileDropped`）。原因：VS 偵錯時開檔案選擇視窗可能讓偵錯中斷。
- `PlanPanel` 用 `d-none` 隱藏而非不渲染。原因：`MudFileUpload` 必須一直存在。
- Razor 迴圈中不要在子元件內容使用 `for` 的迴圈變數，改用 `foreach` 的區域變數。原因：子內容延後渲染，曾在 `Home.razor` 造成索引越界。
- 沒有頂端 App Bar、提示訊息放在下方中央。原因：畫布滿版，右上是模擬控制列。

## 介面規範
- 使用者可見文字一律繁體中文，包含 litegraph 的選單與對話框。
- 節點狀態顏色（使用者指定）：運轉中綠、減產黃、停擺或規劃／連線有問題紅（節點也標紅）、啟動中藍。
- 暫存長條（插槽文字後面的填色）用淡藍色，**不用綠黃紅**，避免和節點狀態色混淆。

## 規劃檔與儲存（改格式前須先與使用者確認）
- 規劃檔＝`ProductionPlan` 的 JSON（`nodes`、`sources`、`edges`、`groups`、`notes`），匯出、匯入、自動存檔共用；群組與註解不參與計算。
- 自動存檔在瀏覽器 `localStorage` 鍵 `coiplanner.plan`；讀取失敗時改用空白規劃並提示。匯入上限 1 MB（`MaxImportBytes`）。
- 新欄位必須有預設值，舊檔才能載入；資料中不存在的機器／物品節點於載入時略過並提示。
- `Data/game.json` 的結構由使用者手動維護，同樣視為對外格式。

## 環境陷阱
- 冒煙測試的伺服器是 Node 程序，異常中斷時用 `pkill -x node`；`pkill -f`／`pgrep -f` 會連自己的 shell 一起殺掉。
- 使用者在 Windows＋Visual Studio 開發，瀏覽器為 Brave／Chrome，顯示比例常不是 100%。
- 使用者的 Windows 會保留一些埠（Hyper-V／WSL／Docker 的 NAT），綁定時出現「存取權限不足」（10013）。ASP.NET 範本預設的 7xxx HTTPS 埠就曾在保留範圍內，所以本機開發伺服器（`dotnet run`）的 HTTPS 埠用 5443（`launchSettings.json`）。可用 `netsh interface ipv4 show excludedportrange protocol=tcp` 查；新增埠時避開保留範圍。

## 規則（使用者訂定，不可刪改）
- 速率單位統一為「每分鐘」
- 所有配方與吞吐量數字只能來自 Data/*.json，不可自行編造
- 缺資料時請停下來問我

## 工作方式（使用者訂定，不可刪改）
- 每次只做一個階段，做完要能 build 通過並跑測試
- 改動前先說明計畫

## Git 規則（使用者訂定，不可刪改）
- 每完成一個獨立的修改就 commit
- commit 訊息第一行簡述改了什麼，需要時空一行補充原因
- commit 訊息只描述本次修改，不要附上待辦清單
- 需要了解過去的修改時，用 git log 查詢
- commit 訊息一律使用英文

## PROGRESS.md（使用者訂定，不可刪改）
- 記錄已知限制與待辦，需要時再讀，不必每次 commit 都讀
- 只在以下情況更新：完成待辦項目、發現新的已知限制或問題
- 完成的待辦直接刪除，不要搬到「已完成」
- 發現限制或問題解除時直接刪除

## 完成任務後的回覆（使用者訂定，不可刪改）
簡短列出：
1. **本次修改**：做了什麼
2. **尚待改善項目／問題、已知問題**：還沒做完的、發現但未處理的問題、已知限制（沒有就省略）
3. **建議改善方向或功能**：之後可以考慮的改進或新功能，或是可以提高CLAUDE CODE效率的建議（沒有就省略）

## 分支
- 只推送到指定的工作分支；合併到 `feature/domain-model`（預設分支）要等使用者明確要求。`feature/domain-model` 有新 commit（例如使用者在 GitHub 上直接修改）時，先合併進工作分支再推送，不可 force push。回覆用繁體中文。
