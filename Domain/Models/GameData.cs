namespace CoiPlanner.Domain.Models;

/// <summary>從 Data/*.json 載入的物品、配方與機器定義。</summary>
public sealed record GameData
{
    public IReadOnlyList<Product> Products { get; init; } = [];
    public IReadOnlyList<Recipe> Recipes { get; init; } = [];
    public IReadOnlyList<Machine> Machines { get; init; } = [];
}
