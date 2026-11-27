namespace CoiPlanner.Domain.Models;

/// <summary>物品，例如礦石、板材。</summary>
public sealed record Product
{
    public required string Id { get; init; }
    public required string Name { get; init; }

    /// <summary>計量單位，例如「個」或「m³」。</summary>
    public required string Unit { get; init; }

    /// <summary>物品型態，例如流體、散裝；決定連線要用哪一種 <see cref="Transport"/>。</summary>
    public string? Kind { get; init; }

    /// <summary>
    /// 背景統計值（例如空氣污染）：機器會產出，但不能運輸、不能連線，也不能當資源來源，只在物料平衡面板累計。
    /// 不需要物品型態。
    /// </summary>
    public bool Background { get; init; }

    /// <summary>畫布上連線與節點的顏色，格式 <c>#rrggbb</c>；省略時畫面用預設灰色。</summary>
    public string? Color { get; init; }
}
