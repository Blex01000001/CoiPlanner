namespace CoiPlanner.Domain.Models;

/// <summary>使用者規劃的一條產線：機器節點、資源來源，以及它們之間的連線。</summary>
public sealed record ProductionPlan
{
    public IReadOnlyList<Node> Nodes { get; init; } = [];
    public IReadOnlyList<ResourceSource> Sources { get; init; } = [];
    public IReadOnlyList<Edge> Edges { get; init; } = [];
}
