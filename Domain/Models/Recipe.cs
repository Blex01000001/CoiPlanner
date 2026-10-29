namespace CoiPlanner.Domain.Models;

/// <summary>配方：每個週期消耗 Inputs、產出 Outputs。</summary>
public sealed record Recipe
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public IReadOnlyList<ItemAmount> Inputs { get; init; } = [];
    public IReadOnlyList<ItemAmount> Outputs { get; init; } = [];
    public required double CycleSeconds { get; init; }

    /// <summary>單台機器每分鐘的週期數。</summary>
    public double CyclesPerMinute => 60.0 / CycleSeconds;

    /// <summary>單台機器每分鐘消耗指定物品的數量；配方未使用該物品時為 0。</summary>
    public double InputPerMinute(string productId) =>
        Inputs.Where(i => i.ProductId == productId).Sum(i => i.Quantity) * CyclesPerMinute;

    /// <summary>單台機器每分鐘產出指定物品的數量；配方未產出該物品時為 0。</summary>
    public double OutputPerMinute(string productId) =>
        Outputs.Where(o => o.ProductId == productId).Sum(o => o.Quantity) * CyclesPerMinute;
}
