using CoiPlanner.Components.Planning;
using CoiPlanner.Domain.Models;
using CoiPlanner.Domain.Services;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Forms;
using Microsoft.JSInterop;
using MudBlazor;

namespace CoiPlanner.Components.Pages;

/// <summary>產線規劃頁的程式碼；畫面標記在 Planner.razor（注入的服務也宣告在那裡）。</summary>
public partial class Planner
{
    private const string StorageKey = "coiplanner.plan";
    private const long MaxImportBytes = 1024 * 1024;
    // 每 100 毫秒推進一次模擬並把狀態送到畫布；1× 時正好是一步（0.1 秒）
    private static readonly TimeSpan TickInterval = TimeSpan.FromMilliseconds(100);
    // 面板（模擬時間、物料平衡表）每幾次更新重繪一次，畫布則每次都更新
    private const int PanelRefreshTicks = 3;

    private ElementReference _canvas;
    private PlanPanel? _planPanel;
    private IJSObjectReference? _module;
    private IJSObjectReference? _editor;
    private DotNetObjectReference<Planner>? _dotnetRef;
    private ProductionPlan _plan = new();
    private PlanResult? _result;
    private Dictionary<string, Product> _products = new();
    private HashSet<(string MachineId, string RecipeId)> _nodeTypes = new();
    private enum SidePanel { None, Plan, Balance }

    // 一開始收起面板，畫布不被遮住；需要時按右側按鈕打開
    private SidePanel _panel = SidePanel.None;

    private readonly ProductionSimulator _sim = new();
    private SimulationSnapshot? _snapshot;
    private bool _running = true;
    private int _speed = 1;
    private int _tick;
    private readonly CancellationTokenSource _loopCts = new();
    // 匯入或清空後，下一次收到畫布的規劃時讓模擬從頭開始
    private bool _resetOnNextChange;

    // 載入（自動存檔或匯入）的規劃，等畫布回報結果後用來比對有沒有被略過的節點或連線
    private ProductionPlan? _pendingLoad;

    protected override void OnInitialized()
    {
        _products = Data.Products.ToDictionary(p => p.Id);
        _nodeTypes = Data.Machines.SelectMany(m => m.RecipeIds.Select(r => (m.Id, r))).ToHashSet();
    }

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (!firstRender)
            return;

        var saved = await ReadAutosaveAsync();
        _pendingLoad = IsEmpty(saved) ? null : saved;

        _dotnetRef = DotNetObjectReference.Create(this);
        // /js/ 由 Program.cs 以 no-cache 提供，每次載入都會向伺服器確認是不是最新版
        _module = await JS.InvokeAsync<IJSObjectReference>("import", "./js/graphEditor.js");
        _editor = await _module.InvokeAsync<IJSObjectReference>("createEditor", _canvas, _dotnetRef, BuildCatalog(), saved, MaxImportBytes);
        // 第一次 OnGraphChanged 可能比 createEditor 先回來，那時還沒有 _editor 可以顯示結果
        if (_result is not null)
            await _editor.InvokeVoidAsync("applyResult", _result);
        StateHasChanged();

        _ = RunSimulationAsync(_loopCts.Token);
    }

    private async Task RunSimulationAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TickInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(ct))
                await InvokeAsync(SimulationTickAsync);
        }
        catch (OperationCanceledException)
        {
            // 離開頁面
        }
    }

    private async Task SimulationTickAsync()
    {
        if (_editor is null || _loopCts.IsCancellationRequested)
            return;

        try
        {
            if (_running)
                _sim.Run(TickInterval.TotalSeconds * _speed);
            _snapshot = _sim.Snapshot();
            await _editor.InvokeVoidAsync("applySimulation", _snapshot);
            if (++_tick % PanelRefreshTicks == 0)
                StateHasChanged();
        }
        catch (JSDisconnectedException)
        {
            _loopCts.Cancel();
        }
        catch (Exception ex) when (!_loopCts.IsCancellationRequested)
        {
            // 模擬出錯時停下來並提示，不能讓 circuit 中斷
            Logger.LogError(ex, "模擬失敗");
            _running = false;
            Snackbar.Add($"模擬發生錯誤，已暫停：{ex.Message}", Severity.Error);
        }
    }

    // 畫布右側被蓋住的寬度，fit view 時要避開：右側按鈕欄（含間距 68px），面板展開時再加上面板 360px 與間距
    private const int ButtonsInset = 68;
    private const int PanelInset = ButtonsInset + 360 + 12;

    private void TogglePanel(SidePanel panel) => _panel = _panel == panel ? SidePanel.None : panel;

    // 沒開啟的面板按鈕用淺色底，在深色畫布上才看得到
    private string IdleClass(SidePanel panel) => _panel == panel ? "" : "planner-side-button-idle";

    private async Task FitViewAsync()
    {
        if (_editor is not null)
            await _editor.InvokeVoidAsync("fitView", _panel == SidePanel.None ? ButtonsInset : PanelInset);
    }

    private void ResetSimulation()
    {
        _sim.Reset();
        _snapshot = _sim.Snapshot();
    }

    [JSInvokable]
    public async Task OnGraphChanged(ProductionPlan plan)
    {
        _plan = plan;
        _result = Calculator.Calculate(plan);
        _sim.Sync(plan, _result);
        if (_resetOnNextChange)
        {
            _resetOnNextChange = false;
            ResetSimulation();
        }
        if (_editor is not null)
            await _editor.InvokeVoidAsync("applyResult", _result);

        if (_pendingLoad is not null)
        {
            ReportDropped(_pendingLoad, plan);
            _pendingLoad = null;
        }

        await JS.InvokeVoidAsync("localStorage.setItem", StorageKey, Serializer.Serialize(plan));
        StateHasChanged();
    }

    private async Task<ProductionPlan> ReadAutosaveAsync()
    {
        var json = await JS.InvokeAsync<string?>("localStorage.getItem", StorageKey);
        if (string.IsNullOrEmpty(json))
            return new ProductionPlan();

        try
        {
            return Serializer.Deserialize(json);
        }
        catch (GameDataException)
        {
            Snackbar.Add("自動存檔無法讀取，已改用空白規劃。", Severity.Warning);
            return new ProductionPlan();
        }
    }

    private async Task ExportAsync()
    {
        var fileName = $"coiplanner-plan-{DateTime.Now:yyyyMMdd-HHmm}.json";
        await _module!.InvokeVoidAsync("downloadText", fileName, Serializer.Serialize(_plan));
    }

    private async Task ImportAsync(IBrowserFile? file)
    {
        if (file is null || _editor is null)
            return;

        string text;
        try
        {
            using var reader = new StreamReader(file.OpenReadStream(MaxImportBytes));
            text = await reader.ReadToEndAsync();
        }
        catch (IOException)
        {
            Snackbar.Add($"檔案太大，上限為 {MaxImportBytes / 1024} KB。", Severity.Error);
            return;
        }
        catch (Exception ex)
        {
            // 任何未預期的錯誤都不能讓 circuit 中斷，記錄下來並提示使用者
            Logger.LogError(ex, "讀取 {FileName} 失敗", file.Name);
            Snackbar.Add($"無法匯入 {file.Name}：{ex.GetType().Name}: {ex.Message}", Severity.Error);
            return;
        }
        finally
        {
            // 清掉選取，否則再選同一個檔案不會觸發 FilesChanged
            if (_planPanel is not null)
                await _planPanel.ClearSelectionAsync();
        }

        await ImportTextAsync(file.Name, text);
    }

    /// <summary>
    /// 把 .json 檔拖到畫布上匯入。不會開啟檔案選擇視窗：
    /// Visual Studio 偵錯時，部分瀏覽器關閉檔案選擇視窗後 VS 會誤判瀏覽器已關閉而停止偵錯。
    /// </summary>
    [JSInvokable]
    public Task OnFileDropped(string fileName, string text) => ImportTextAsync(fileName, text);

    private async Task ImportTextAsync(string fileName, string text)
    {
        if (_editor is null)
            return;

        ProductionPlan plan;
        try
        {
            plan = Serializer.Deserialize(text);
        }
        catch (GameDataException ex)
        {
            Snackbar.Add($"無法匯入 {fileName}：{ex.Message}", Severity.Error);
            return;
        }

        _pendingLoad = plan;
        _resetOnNextChange = true;
        await _editor.InvokeVoidAsync("load", plan);
        Snackbar.Add($"已匯入 {fileName}。", Severity.Success);
    }

    private async Task ClearAsync()
    {
        var confirmed = await DialogService.ShowMessageBoxAsync(
            "清空規劃", "確定要刪除所有節點與連線嗎？此動作無法復原。", yesText: "清空", cancelText: "取消");
        if (confirmed == true && _editor is not null)
        {
            _resetOnNextChange = true;
            await _editor.InvokeVoidAsync("load", new ProductionPlan());
        }
    }

    /// <summary>
    /// 畫布只會建立目前資料認得的節點類型，且一個輸入插槽只能接一條線；
    /// 載入後比對數量，讓使用者知道有東西沒被載入。
    /// </summary>
    private void ReportDropped(ProductionPlan requested, ProductionPlan loaded)
    {
        var droppedNodes = requested.Nodes.Count + requested.Sources.Count - loaded.Nodes.Count - loaded.Sources.Count;
        var droppedEdges = requested.Edges.Count - loaded.Edges.Count;
        if (droppedNodes <= 0 && droppedEdges <= 0)
            return;

        var unknown = requested.Nodes.Count(n => !_nodeTypes.Contains((n.MachineId, n.RecipeId)))
            + requested.Sources.Count(s => !_products.ContainsKey(s.ProductId));
        var parts = new List<string>();
        if (droppedNodes > 0)
            parts.Add($"{droppedNodes} 個節點（其中 {unknown} 個的機器、配方或物品不在目前資料中）");
        if (droppedEdges > 0)
            parts.Add($"{droppedEdges} 條連線");
        Snackbar.Add($"載入時略過了 {string.Join("、", parts)}。", Severity.Warning);
    }

    /// <summary>每個「機器 × 可執行配方」組合是一種節點類型。</summary>
    private object BuildCatalog() => new
    {
        NodeTypes = Data.Machines
            .SelectMany(m => m.RecipeIds.Select(id => (Machine: m, Recipe: Data.Recipes.First(r => r.Id == id))))
            .Select(x => new
            {
                MachineId = x.Machine.Id,
                MachineName = x.Machine.Name,
                RecipeId = x.Recipe.Id,
                RecipeName = x.Recipe.Name,
                Inputs = x.Recipe.Inputs.Select(i => Slot(i.ProductId)),
                Outputs = x.Recipe.Outputs.Select(o => Slot(o.ProductId)),
            }),
        // 每個物品都可以放一個資源來源節點
        Products = Data.Products.Select(p => Slot(p.Id)),
        Transports = Data.Transports.Select(t => new { t.Id, t.Name, t.Kind, t.TiersPerMinute }),
    };

    private object Slot(string productId) => new
    {
        ProductId = productId,
        Name = _products[productId].Name,
        Unit = _products[productId].Unit,
        Kind = _products[productId].Kind,
    };

    private static bool IsEmpty(ProductionPlan plan) =>
        plan.Nodes.Count == 0 && plan.Sources.Count == 0 && plan.Groups.Count == 0 && plan.Notes.Count == 0;

    public async ValueTask DisposeAsync()
    {
        _loopCts.Cancel();
        try
        {
            if (_editor is not null)
            {
                await _editor.InvokeVoidAsync("dispose");
                await _editor.DisposeAsync();
            }
            if (_module is not null)
                await _module.DisposeAsync();
        }
        catch (JSDisconnectedException)
        {
            // 連線已中斷時瀏覽器端的物件已經不存在，不需要清理
        }
        _dotnetRef?.Dispose();
        _loopCts.Dispose();
    }
}
