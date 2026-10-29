namespace CoiPlanner.Domain.Models;

/// <summary>產線上的一個節點：Count 台同類型機器執行同一配方。</summary>
public sealed record Node
{
    public required string Id { get; init; }
    public required string MachineId { get; init; }
    public required string RecipeId { get; init; }
    public required int Count { get; init; }
}
