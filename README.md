# CoiPlanner：Captain of Industry 產線規劃工具

用 Blazor WebAssembly 做的靜態網頁「規劃與模擬」控制台。不連線遊戲，物品、配方與機器資料來自 `Data/*.json`，產線由使用者在 ComfyUI 風格的節點編輯器中自行規劃。

## 技術
- .NET 8、Blazor WebAssembly 獨立版（靜態網站，沒有伺服器）、MudBlazor 9
- 節點編輯器：[@comfyorg/litegraph](https://www.npmjs.com/package/@comfyorg/litegraph) 0.17.2（MIT，放在 `wwwroot/lib/litegraph/`）
- 計算邏輯在 `Domain/`（不依賴 UI），測試在 `tests/CoiPlanner.Domain.Tests`（xUnit）

## 執行
```bash
dotnet run --project CoiPlanner.csproj    # 開發伺服器，只負責提供靜態檔案
```
```bash
dotnet test                               # 單元測試（Domain）
node tests/e2e/smoke.cjs                  # 瀏覽器冒煙測試（先 dotnet build）
```
改了 `Data/*.json` 要重新建置（資料在建置時編進組件）。

## 部署（GitHub Pages）
- 推到 `feature/domain-model`（預設分支）時，`.github/workflows/deploy.yml` 會跑測試、發佈並部署到 `https://<帳號>.github.io/CoiPlanner/`。
- 第一次使用：儲存庫 Settings → Pages → Build and deployment → Source 選「GitHub Actions」。
- 發佈檔案的整理（子路徑、版本號、`404.html`、`.nojekyll`）在 `scripts/prepare-pages.cjs`。

## 專案結構
| 路徑 | 內容 |
|---|---|
| `Data/*.json` | 遊戲資料，依用途分檔：物品（`10-products.json`）、運輸方式（`11-transports.json`），機器與配方依產業分檔（`20-mining.json`…`70-assembly.json`）；啟動時全部合併並驗證 |
| `Domain/Models` | 遊戲資料（GameData、Product、Recipe、Machine、Transport）、規劃檔（ProductionPlan、Node、ResourceSource、Edge）、檢查結果（PlanResult）、模擬參數與狀態（`Simulation.cs`）、配方成本結果（`RecipeCost.cs`） |
| `Domain/Services` | `GameDataLoader`（載入資料）、`PlanCalculator`（規劃檢查、額定速率、運輸上限）、`ProductionSimulator`（逐步模擬）、`RecipeCostCalculator`（配方成本比較）、`ProductionPlanSerializer`（規劃存取） |
| `NAMES.md` | 名稱對照表：同義名稱、名稱相近的不同物品、名稱寫法規則 |
| `Services/BrowserStorage.cs` | 瀏覽器儲存（自動存檔、配方成本的設定）的讀寫與鍵名 |
| `Components/Layout/MainLayout.razor` | 共用版面：左側浮動換頁按鈕 |
| `Components/Pages/Home.razor` | 資料瀏覽（`/data`） |
| `Components/Pages/Cost.razor` | 配方成本比較（`/cost`，整頁滿版） |
| `Components/Pages/Planner.razor`、`Planner.razor.cs` | 產線規劃頁（節點編輯器）：版面與程式碼 |
| `Components/Planning/` | 規劃頁的畫面元件：模擬控制列、規劃面板、物料平衡面板 |
| `scripts/prepare-pages.cjs` | 發佈後整理成 GitHub Pages 內容（子路徑、版本號、404.html） |
| `scripts/assign-colors.cjs` | 幫還沒有 `color` 的物品自動補上不重複的顏色（新增物品時用） |
| `.github/workflows/deploy.yml` | 測試、發佈並部署到 GitHub Pages |
| `wwwroot/js/graphEditor.js`、`wwwroot/js/graphEditor/` | litegraph 包裝（入口與 ES 模組）；只負責畫面，計算一律在 C# |
| `tests/CoiPlanner.Domain.Tests/` | 單元測試；`Fixtures/` 是測試專用的虛構資料，不會被網站載入 |
| `tests/e2e/` | 瀏覽器冒煙測試與測試用規劃檔 |
| `PROGRESS.md` | 已知限制與待辦 |

## 修改紀錄
見 `git log`。

## 已知限制與待辦
見 [PROGRESS.md](PROGRESS.md)。
