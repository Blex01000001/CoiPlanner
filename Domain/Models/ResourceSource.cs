namespace CoiPlanner.Domain.Models;

/// <summary>
/// 資源來源：不經配方、以固定速率產出某一物品，用來模擬礦場等原料供應。
/// 速率由使用者輸入，不來自 Data/*.json。
/// </summary>
public sealed record ResourceSource
{
    public required string Id { get; init; }
    public required string ProductId { get; init; }
    public required double RatePerMinute { get; init; }

    /// <summary>在編輯器畫布上的位置，只影響顯示，不影響計算。</summary>
    public double X { get; init; }
    public double Y { get; init; }
}
