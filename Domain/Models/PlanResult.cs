namespace CoiPlanner.Domain.Models;

/// <summary>某一物品的每分鐘速率。</summary>
public sealed record ProductRate(string ProductId, double PerMinute);

/// <summary>單一節點（Count 台機器合計）全速運轉時每分鐘的額定消耗與產出。</summary>
public sealed record NodeResult(string NodeId, IReadOnlyList<ProductRate> Inputs, IReadOnlyList<ProductRate> Outputs);

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
    public bool IsValid => Issues.Count == 0;
}
