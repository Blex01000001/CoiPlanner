namespace CoiPlanner.Domain.Models;

/// <summary>兩個節點之間運送某一物品的連線。</summary>
public sealed record Edge
{
    public required string SourceNodeId { get; init; }
    public required string TargetNodeId { get; init; }
    public required string ProductId { get; init; }

    /// <summary>運輸方式，例如輸送帶或管線；可選項目由資料決定。</summary>
    public required string Transport { get; init; }
}
