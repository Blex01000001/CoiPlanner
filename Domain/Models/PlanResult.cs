namespace CoiPlanner.Domain.Models;

/// <summary>某一物品的每分鐘速率。</summary>
public sealed record ProductRate(string ProductId, double PerMinute);

/// <summary>單一節點（Count 台機器合計）全速運轉時每分鐘的額定消耗與產出。</summary>
public sealed record NodeResult(
    string NodeId,
    IReadOnlyList<ProductRate> Inputs,
    IReadOnlyList<ProductRate> Outputs,
    double PowerUseKw = 0,
    double PowerGenerationKw = 0,
    double Workers = 0,
    string? MaintenanceType = null,
    double MaintenancePerMinute = 0);

/// <summary>某一種維修每分鐘的總需求量。</summary>
public sealed record MaintenanceTotal(string Type, double PerMinute);

/// <summary>規劃中的問題；NodeId 或 EdgeIndex 指出問題所在位置。</summary>
public sealed record PlanIssue(string Message, string? NodeId = null, int? EdgeIndex = null);

/// <summary>
/// 規劃的檢查結果。Nodes 只包含通過檢查的節點；EdgeCapacities 依 <see cref="ProductionPlan.Edges"/> 的順序列出
/// 每條連線每分鐘的運輸上限，連線有問題時為 null。實際的流量與產量由 <see cref="Services.ProductionSimulator"/> 模擬。
/// </summary>
public sealed record PlanResult(
    IReadOnlyList<NodeResult> Nodes,
    IReadOnlyList<PlanIssue> Issues,
    IReadOnlyList<double?> EdgeCapacities)
{
    /// <summary>全部機器額定耗電（kW）。</summary>
    public double PowerUseKw => Nodes.Sum(n => n.PowerUseKw);

    /// <summary>全部發電機額定發電量（kW）。</summary>
    public double PowerGenerationKw => Nodes.Sum(n => n.PowerGenerationKw);

    /// <summary>全部機器需要的工人總數。</summary>
    public double Workers => Nodes.Sum(n => n.Workers);

    /// <summary>全部機器每分鐘需要的各種維修量，依種類名稱排序。</summary>
    public IReadOnlyList<MaintenanceTotal> Maintenance => Nodes
        .Where(n => !string.IsNullOrWhiteSpace(n.MaintenanceType) && n.MaintenancePerMinute > 0)
        .GroupBy(n => n.MaintenanceType!)
        .OrderBy(g => g.Key, StringComparer.Ordinal)
        .Select(g => new MaintenanceTotal(g.Key, g.Sum(n => n.MaintenancePerMinute)))
        .ToList();

    public bool IsValid => Issues.Count == 0;
}
