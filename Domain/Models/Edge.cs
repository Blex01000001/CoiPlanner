namespace CoiPlanner.Domain.Models;

/// <summary>兩個節點之間運送某一物品的連線。</summary>
public sealed record Edge
{
    public required string SourceNodeId { get; init; }
    public required string TargetNodeId { get; init; }
    public required string ProductId { get; init; }

    /// <summary>運輸方式的 id（<see cref="Models.Transport"/>）；必須是這個物品型態對應的運輸方式。</summary>
    public required string Transport { get; init; }

    /// <summary>運輸方式的等級，從 1 起算；舊的規劃檔沒有這個欄位時視為一級。</summary>
    public int Tier { get; init; } = 1;
}
