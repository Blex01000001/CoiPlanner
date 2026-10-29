# Captain of Industry 產線規劃工具

## 目標
用 Blazor Server 做一個「規劃與模擬」控制台，顯示節點名稱、速率、流向。
不連線遊戲，資料由使用者輸入或載入 JSON。
規劃畫面是 ComfyUI 風格的節點編輯器：深色網格背景，節點與連線可拖動、連接。

## 技術
- .NET 版本：.NET 8（net8.0）
- Blazor Web App，Interactive Server
- UI 套件：MudBlazor
- 節點編輯器：@comfyorg/litegraph（JS），透過 JS interop 與 C# 溝通；JS 只負責畫面，計算一律在 C# Domain
- 計算邏輯放在獨立的 Domain 資料夾，不依賴 UI，並附 xUnit 測試

## 領域模型
- Product：物品（名稱、單位）
- Recipe：輸入物品與數量、輸出物品與數量、週期秒數
- Machine：機器類型，可執行哪些 Recipe
- Node：產線上的一個機器節點（類型、Recipe、數量）
- Edge：節點之間的連線（來源、目標、物品、運輸方式）

## 規則
- 速率單位統一為「每分鐘」
- 所有配方與吞吐量數字只能來自 Data/*.json，不可自行編造
- 缺資料時請停下來問我

## 工作方式
- 每次只做一個階段，做完要能 build 通過並跑測試
- 改動前先說明計畫
- 每次 commit 時同步更新 README.md 的「已改善」與「尚待改善」清單，並在回報中列出