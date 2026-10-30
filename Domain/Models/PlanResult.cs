namespace CoiPlanner.Domain.Models;

/// <summary>某一物品的每分鐘速率。</summary>
public sealed record ProductRate(string ProductId, double PerMinute);

/// <summary>單一節點（Count 台機器合計）每分鐘的消耗與產出。</summary>
public sealed record NodeResult(string NodeId, IReadOnlyList<ProductRate> Inputs, IReadOnlyList<ProductRate> Outputs);

/// <summary>整條產線對某一物品的總產出、總消耗與差額（正值為剩餘，負值為不足）。</summary>
public sealed record ProductBalance(string ProductId, double SupplyPerMinute, double DemandPerMinute)
{
    public double NetPerMinute => SupplyPerMinute - DemandPerMinute;
}

/// <summary>
/// 一條連線每分鐘實際運送的量與運輸上限。EdgeIndex 是連線在 <see cref="ProductionPlan.Edges"/> 中的位置；
/// 連線有錯誤（例如運輸方式不符）時 CapacityPerMinute 為 null、流量為 0。
/// </summary>
public sealed record EdgeResult(int EdgeIndex, double FlowPerMinute, double? CapacityPerMinute)
{
    public bool IsFull => CapacityPerMinute is { } cap && FlowPerMinute >= cap - 1e-9;
}

/// <summary>規劃中的問題；NodeId 或 EdgeIndex 指出問題所在位置。</summary>
public sealed record PlanIssue(string Message, string? NodeId = null, int? EdgeIndex = null);

public sealed record PlanResult(
    IReadOnlyList<NodeResult> Nodes,
    IReadOnlyList<ProductBalance> Balances,
    IReadOnlyList<PlanIssue> Issues,
    IReadOnlyList<EdgeResult> Edges)
{
    public bool IsValid => Issues.Count == 0;
}
