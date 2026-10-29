namespace CoiPlanner.Domain.Models;

/// <summary>物品，例如礦石、板材。</summary>
public sealed record Product
{
    public required string Id { get; init; }
    public required string Name { get; init; }

    /// <summary>計量單位，例如「個」或「m³」。</summary>
    public required string Unit { get; init; }
}
