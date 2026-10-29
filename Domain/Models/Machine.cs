namespace CoiPlanner.Domain.Models;

/// <summary>機器類型，以及它能執行的配方。</summary>
public sealed record Machine
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public IReadOnlyList<string> RecipeIds { get; init; } = [];

    public bool CanRun(string recipeId) => RecipeIds.Contains(recipeId);
}
