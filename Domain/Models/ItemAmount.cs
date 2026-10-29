namespace CoiPlanner.Domain.Models;

/// <summary>配方中某一物品每個週期的投入或產出數量。</summary>
public sealed record ItemAmount
{
    public required string ProductId { get; init; }
    public required double Quantity { get; init; }
}
