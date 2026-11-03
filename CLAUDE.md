# CoiPlanner：Captain of Industry 產線規劃工具

Blazor Web App（.NET 8、Interactive Server）＋ MudBlazor 的產線規劃與模擬工具。不連線遊戲，資料來自 `Data/*.json`；規劃畫面是 ComfyUI 風格節點編輯器（@comfyorg/litegraph）。
**JS 只負責畫面，計算一律在 C# `Domain/`（不依賴 UI，附 xUnit 測試）。** 細節以程式碼與檔案開頭註解為準。

## 檔案地圖
| 檔案 | 負責 | 常見修改 |
|---|---|---|
| `Data/game.json` | 物品（含運輸型態 `kind`）、配方、機器、運輸方式。啟動時 `GameDataLoader.LoadFromDirectory` 載入全部 `Data/*.json` 並驗證，有錯網站無法啟動 | 新增／刪除機器、配方、物品 |
| `Domain/Models/` | 領域模型。`ProductionPlan.cs`＝規劃檔格式；`Simulation.cs`＝模擬參數與狀態 | 加欄位 |
| `Domain/Services/PlanCalculator.cs` | 規劃檢查（問題清單）、額定速率、連線運輸上限；**不算實際流量** | 新增檢查規則 |
| `Domain/Services/ProductionSimulator.cs` | 逐步模擬：實際流量、稼動率、狀態、物料平衡 | 模擬行為 |
| `Domain/Services/GameDataLoader.cs` | 載入與跨檔驗證遊戲資料 | 新資料欄位的驗證 |
| `Domain/Services/ProductionPlanSerializer.cs`、`JsonDefaults.cs` | 規劃 JSON（camelCase、允許註解與尾逗號） | 很少改 |
| `Components/Pages/Planner.razor` | 產線規劃頁：interop、模擬迴圈、控制列、面板、匯入匯出、自動存檔 | 面板、控制項 |
| `wwwroot/js/graphEditor.js` | litegraph 包裝：節點類型、選單、格線、標籤、箭頭、群組、註解、fit view | 畫布外觀與互動 |
| `Components/Pages/Home.razor` | 資料瀏覽（物品、配方、機器、運輸） | 顯示新資料欄位 |
| `Components/Layout/MainLayout.razor` | 無 App Bar，左上浮動選單按鈕＋抽屜 | 很少改 |
| `Components/App.razor` | `<head>`、CSS 版本號（`Versioned`） | 新增 CSS |
| `Program.cs` | DI、SignalR 上限、提示訊息位置、`logs/crash.log` | 很少改 |
| `wwwroot/app.css` | 版面：畫布滿版、浮動元件位置 | 位置與樣式 |
| `wwwroot/lib/litegraph/` | 第三方 litegraph 0.17.2；搜尋預設略過（`.ignore`），查內部實作時明確指定路徑 | **不可修改** |
| `tests/e2e/smoke.cjs`、`tests/e2e/fixtures/` | 瀏覽器冒煙測試與測試用規劃檔（使用實際的機器 id） | 新增畫面功能時補步驟 |
| `tests/CoiPlanner.Domain.Tests/` | xUnit。虛構測試資料只在 `Fixtures/sample.json`（`TestData.Sample` 由它載入）；`RealGameDataTests.cs` 檢查實際的 `Data/game.json` | 每次改 Domain 或資料都補 |
| `README.md` | 專案說明、執行方式、專案結構 | 結構或執行方式改變時 |
| `PROGRESS.md` | 已知限制與待辦（更新規則見下方「PROGRESS.md」） | 需要時才讀 |

## 修改後的驗證
```bash
dotnet build    # 乾淨建置約 30 秒；改 C#／Razor 後必跑
dotnet test     # 約 10 秒（含增量建置）；每次 commit 前必跑
dotnet test --no-build --filter "FullyQualifiedName~ProductionSimulatorTests"   # 只跑一個類別，約 2 秒
```
```bash
node --check wwwroot/js/graphEditor.js    # 改 JS 後必跑（1 秒）
node tests/e2e/smoke.cjs                  # 瀏覽器冒煙測試，約 35 秒；改 JS／Razor／CSS 後、commit 前必跑（需先 dotnet build）
```
- 冒煙測試自己在 5170 埠啟動網站；失敗時印出步驟並截圖到 `tests/e2e/.output/`。新增畫面功能時在 `smoke.cjs` 補一個 `step`。
- **測試全過才 commit，不可為了通過而跳過或刪除測試。**
- 第一次在雲端容器：沒有 `dotnet` 時執行 `apt-get install -y dotnet-sdk-8.0`（約 1 分鐘）。

## 常見任務
1. **新增／刪除機器、配方、物品**：只改 `Data/game.json`。配方一律 `cycleSeconds: 60`，`quantity` 即每分鐘量；新物品必須有 `kind`，且該型態要有運輸方式。`RealGameDataTests` 會檢查每個配方都有機器執行、每個物品都出現在配方中；新增重要配方時可補抽查值。刪除的機器在舊存檔中會於載入時略過並提示（`ReportDropped`）；`tests/e2e/fixtures/` 用到的話一起改。
2. **規劃檔加欄位**：`ProductionPlan.cs`（給預設值，舊檔才能載入）→ `graphEditor.js` 的 `snapshot()` 與 `load()` → `ProductionPlanSerializerTests` 補往返測試。
3. **新增規劃檢查**：`PlanCalculator`；問題要帶 `NodeId` 或 `EdgeIndex`，畫布才會標紅。補 `PlanCalculatorTests`。
4. **改模擬行為**：`ProductionSimulator`／`SimulationSettings`，補 `ProductionSimulatorTests`；畫面只改 `applySimulation`、`statusOf`。
5. **畫布互動、選單**：`graphEditor.js`，用節點子類或 canvas 實例覆寫，不改 lib（覆寫清單見該檔開頭）。
6. **新增 JS→C# 呼叫**：C# 方法加 `[JSInvokable]`，JS 用 `dotnetRef.invokeMethodAsync`；單一訊息上限 2 MB。

## 架構決策（不要改回去）
- **不修改 `wwwroot/lib/litegraph/`**：檔案原樣複製自 npm，才能直接升級；行為差異全在 `graphEditor.js` 覆寫。
- 插槽數固定為配方數；同一輸入的第二條以後連線接到疊在原插槽上的隱藏合流插槽（`mergeSlotFor`、`syncInputSlots`）。原因：使用者要求插槽數固定，而 litegraph 一個輸入只能接一條線。
- 運輸方式由物品 `kind` 決定（一種型態只走一種運輸），使用者只選等級；`Edge.Transport` 仍存檔，供 C# 檢查。
- `PlanCalculator` 只做檢查與額定值，實際數字一律來自 `ProductionSimulator`。原因：使用者選擇「只做模擬」。
- 模擬規則皆為使用者決定：連續流量、依連線建立順序填滿、沒接線的輸入＝0（停擺）、沒接線的輸出送進倉庫。`SimulationSettings` 預設值（暫存 1 分鐘、運送 0.5 秒、啟動 0.5 秒）是使用者暫訂，**改動前先問**。
- 模擬在 C# 以 100 ms 計時器推進、推給 JS；面板每 `PanelRefreshTicks` 次才重繪。原因：控制 SignalR 流量。
- `graphEditor.js` 以 `?v=檔案時間` 載入，CSS 也加版本號。原因：瀏覽器曾沿用舊 CSS，畫布上方出現白條。
- 畫布像素＝CSS 大小 × `devicePixelRatio`，並對前景 ctx `setTransform`（`fitCanvas`）。原因：Windows 顯示比例 125%／150% 時畫面模糊且只畫一部分。
- 格線在 `onRenderBackground` 畫，不用 `onDrawBackground`。原因：後者會蓋掉群組。格線間距＝Shift 對齊間距 `GRID_SIZE`，對齊以含標題的外框為準。
- Shift 在 `window` 追蹤並切換 `LiteGraph.alwaysSnapToGrid`。原因：litegraph 只在 canvas 有焦點時才知道 Shift。
- 保留拖放 .json 匯入（`OnFileDropped`）。原因：VS 偵錯時開檔案選擇視窗可能讓偵錯中斷。
- SignalR `MaximumReceiveMessageSize` 2 MB。原因：預設 32 KB，規劃稍大就斷線。
- 產線規劃面板用 `d-none` 隱藏而非不渲染。原因：`MudFileUpload` 必須一直存在。
- Razor 迴圈中不要在子元件內容使用 `for` 的迴圈變數，改用 `foreach` 的區域變數。原因：子內容延後渲染，曾在 `Home.razor` 造成索引越界。
- 沒有頂端 App Bar、提示訊息放在下方中央。原因：畫布滿版，右上是模擬控制列。

## 介面規範
- 使用者可見文字一律繁體中文，包含 litegraph 的選單與對話框。
- 節點狀態顏色（使用者指定）：運轉中綠、減產黃、停擺或規劃／連線有問題紅（節點也標紅）、啟動中藍。

## 規劃檔與儲存（改格式前須先與使用者確認）
- 規劃檔＝`ProductionPlan` 的 JSON（`nodes`、`sources`、`edges`、`groups`、`notes`），匯出、匯入、自動存檔共用；群組與註解不參與計算。
- 自動存檔在瀏覽器 `localStorage` 鍵 `coiplanner.plan`；讀取失敗時改用空白規劃並提示。匯入上限 1 MB（`MaxImportBytes`）。
- 新欄位必須有預設值，舊檔才能載入；資料中不存在的機器／物品節點於載入時略過並提示。
- `Data/game.json` 的結構由使用者手動維護，同樣視為對外格式。

## 環境陷阱
- 停止網站用 `pkill -x CoiPlanner`；`pkill -f`／`pgrep -f` 會連自己的 shell 一起殺掉。
- 使用者在 Windows＋Visual Studio 開發，瀏覽器為 Brave／Chrome，顯示比例常不是 100%。

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
