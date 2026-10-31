namespace CoiPlanner.Domain.Models;

/// <summary>
/// 使用者規劃的一條產線：機器節點、資源來源，以及它們之間的連線。
/// 群組與註解只用來整理畫面，不參與計算與模擬。
/// </summary>
public sealed record ProductionPlan
{
    public IReadOnlyList<Node> Nodes { get; init; } = [];
    public IReadOnlyList<ResourceSource> Sources { get; init; } = [];
    public IReadOnlyList<Edge> Edges { get; init; } = [];
    public IReadOnlyList<PlanGroup> Groups { get; init; } = [];
    public IReadOnlyList<PlanNote> Notes { get; init; } = [];
}

/// <summary>畫布上框住一塊區域的群組，例如「煉鋼區」。Color 為 null 時用預設顏色。</summary>
public sealed record PlanGroup
{
    public required string Title { get; init; }
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public string? Color { get; init; }
}

/// <summary>畫布上的文字註解。</summary>
public sealed record PlanNote
{
    public required string Id { get; init; }
    public string Title { get; init; } = "註解";
    public string Text { get; init; } = "";
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }

    /// <summary>litegraph 內建配色的名稱（例如 "yellow"），null 時用註解的預設顏色。</summary>
    public string? Color { get; init; }
}
