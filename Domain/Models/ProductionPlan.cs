namespace CoiPlanner.Domain.Models;

/// <summary>使用者規劃的一條產線：節點與節點之間的連線。</summary>
public sealed record ProductionPlan
{
    public IReadOnlyList<Node> Nodes { get; init; } = [];
    public IReadOnlyList<Edge> Edges { get; init; } = [];
}
