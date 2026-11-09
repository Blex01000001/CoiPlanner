namespace CoiPlanner.Domain.Models;

/// <summary>機器類型，以及它能執行的配方。</summary>
public sealed record Machine
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    /// <summary>右鍵選單「新增節點」的第一層分類。</summary>
    public string Category { get; init; } = "其他";
    public IReadOnlyList<string> RecipeIds { get; init; } = [];

    public bool CanRun(string recipeId) => RecipeIds.Contains(recipeId);
}
