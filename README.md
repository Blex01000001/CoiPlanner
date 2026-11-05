# CoiPlanner：Captain of Industry 產線規劃工具

用 Blazor Server 做的「規劃與模擬」控制台。不連線遊戲，物品、配方與機器資料來自 `Data/*.json`，產線由使用者在 ComfyUI 風格的節點編輯器中自行規劃。

## 技術
- .NET 8、Blazor Web App（Interactive Server）、MudBlazor 9
- 節點編輯器：[@comfyorg/litegraph](https://www.npmjs.com/package/@comfyorg/litegraph) 0.17.2（MIT，放在 `wwwroot/lib/litegraph/`）
- 計算邏輯在 `Domain/`（不依賴 UI），測試在 `tests/CoiPlanner.Domain.Tests`（xUnit）

## 執行
```bash
dotnet run --project CoiPlanner.csproj
```
```bash
dotnet test
```

## 專案結構
| 路徑 | 內容 |
|---|---|
| `Data/*.json` | 物品（含運輸型態）、配方、機器與運輸方式資料；啟動時全部載入並驗證（目前是 `Data/game.json`） |
| `Domain/Models` | Product、Recipe、Machine、Transport、Node、ResourceSource、Edge、ProductionPlan；`Simulation.cs` 為模擬參數與狀態 |
| `Domain/Services` | `GameDataLoader`（載入資料）、`PlanCalculator`（規劃檢查、額定速率、運輸上限）、`ProductionSimulator`（逐步模擬）、`ProductionPlanSerializer`（規劃存取） |
| `Components/Pages/Home.razor` | 資料瀏覽 |
| `Components/Pages/Planner.razor` | 產線規劃（節點編輯器） |
| `wwwroot/js/graphEditor.js`、`wwwroot/js/graphEditor/` | litegraph 包裝（入口與 ES 模組）；只負責畫面，計算一律在 C# |
| `tests/CoiPlanner.Domain.Tests/Fixtures` | 測試專用的虛構資料，不會被網站載入 |

## 修改紀錄
見 `git log`。

## 已知限制與待辦
見 [PROGRESS.md](PROGRESS.md)。
