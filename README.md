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
| `Data/*.json` | 物品、配方、機器資料；啟動時全部載入並驗證 |
| `Domain/Models` | Product、Recipe、Machine、Node、ResourceSource、Edge、ProductionPlan |
| `Domain/Services` | `GameDataLoader`（載入資料）、`PlanCalculator`（速率與物料平衡）、`ProductionPlanSerializer`（規劃存取） |
| `Components/Pages/Home.razor` | 資料瀏覽 |
| `Components/Pages/Planner.razor` | 產線規劃（節點編輯器） |
| `wwwroot/js/graphEditor.js` | litegraph 包裝；只負責畫面，計算一律在 C# |

## 已改善
- 領域模型與 JSON 資料載入，含跨檔案的 id 與引用檢查
- MudBlazor 介面與資料瀏覽頁（物品、配方含每分鐘速率、機器）
- 產線計算：節點速率、物料平衡、規劃錯誤檢查
- ComfyUI 風格節點編輯器：拖動節點、依物品連線、調整機器數量，速率與錯誤即時顯示
- 規劃自動存在瀏覽器，可匯出／匯入 JSON、清空
- 節點可用 Delete 鍵或右鍵 → Remove 刪除
- 資源節點：以使用者輸入的每分鐘產量模擬原料供應（例如 Iron Ore）
- 產線規劃頁的畫布佔滿視窗，結果面板浮在畫布上且可收合
- 多個來源可以合流到同一台機器：輸入插槽接上線後會自動多開一個同物品的空插槽
- 連線上有沿方向移動的流動動畫

## 尚待改善
- 在 Visual Studio 偵錯時匯入 .json 會中斷偵錯（原因調查中）
- 連線上不顯示實際流量數字；動畫速度固定，不代表流量大小（需要先決定一個來源接多個目標時的分配規則）
- 運輸方式（Edge.Transport）尚未定義，目前存成空字串
- `Data/sample.json` 只有示範用的虛構配方；真實遊戲資料尚未輸入
- 節點右鍵選單的 Clone 未測試，複製出的數量可能不正確
- 節點標題過長時會被截斷
