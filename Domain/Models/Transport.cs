namespace CoiPlanner.Domain.Models;

/// <summary>運輸方式，例如管線或輸送帶。一種物品型態只能走一種運輸方式。</summary>
public sealed record Transport
{
    public required string Id { get; init; }
    public required string Name { get; init; }

    /// <summary>可運送的物品型態，對應 <see cref="Product.Kind"/>。</summary>
    public required string Kind { get; init; }

    /// <summary>各等級每分鐘的吞吐量；第 0 個是一級。</summary>
    public IReadOnlyList<double> TiersPerMinute { get; init; } = [];

    /// <summary>指定等級（從 1 起算）的每分鐘吞吐量；等級不存在時為 null。</summary>
    public double? CapacityPerMinute(int tier) =>
        tier >= 1 && tier <= TiersPerMinute.Count ? TiersPerMinute[tier - 1] : null;
}
