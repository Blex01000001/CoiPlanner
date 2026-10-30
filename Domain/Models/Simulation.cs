using System.Text.Json.Serialization;

namespace CoiPlanner.Domain.Models;

/// <summary>
/// 模擬參數。這些是使用者暫訂的模擬設定，不是遊戲資料：
/// 暫存容量為 3 分鐘的額定用量、運送 0.5 秒、輸入齊了 0.5 秒後開始生產（讓啟動過程看得出先後順序）。
/// </summary>
public sealed record SimulationSettings
{
    /// <summary>每一步模擬的秒數。</summary>
    public double StepSeconds { get; init; } = 0.1;

    /// <summary>每個輸入／輸出暫存區可存放幾分鐘的額定用量。</summary>
    public double BufferMinutes { get; init; } = 3;

    /// <summary>物品在連線上運送的秒數。</summary>
    public double TransitSeconds { get; init; } = 0.5;

    /// <summary>機器的輸入都有料後，等多少秒才開始生產。</summary>
    public double StartupSeconds { get; init; } = 0.5;

    /// <summary>畫面上顯示的速率取最近多少秒的平均。</summary>
    public double AverageSeconds { get; init; } = 5;
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum NodeStatus
{
    /// <summary>正在生產；Utilization 小於 1 時為減產。</summary>
    Running,

    /// <summary>輸入都有料了，正在等待啟動延遲。</summary>
    Starting,

    /// <summary>有輸入沒料（包含沒接線的輸入），停擺。</summary>
    Starved,

    /// <summary>輸出暫存區滿了，下游收不下，停擺。</summary>
    Blocked,
}

/// <summary>節點上某一物品的實際速率（最近幾秒平均）、額定速率與暫存量。</summary>
public sealed record SlotState(string ProductId, double ActualPerMinute, double RatedPerMinute, double Stock, double Capacity);

/// <summary>
/// 節點目前的狀態。Utilization 是最近幾秒的平均稼動率（0～1）；
/// MissingInputs 是造成停擺、沒有料的輸入物品。
/// </summary>
public sealed record NodeState(
    string NodeId,
    NodeStatus Status,
    double Utilization,
    double StartupRemainingSeconds,
    IReadOnlyList<string> MissingInputs,
    IReadOnlyList<SlotState> Inputs,
    IReadOnlyList<SlotState> Outputs);

/// <summary>一條連線最近幾秒平均每分鐘運送的量與運輸上限；EdgeIndex 是連線在 <see cref="ProductionPlan.Edges"/> 中的位置。</summary>
public sealed record EdgeState(int EdgeIndex, double FlowPerMinute, double CapacityPerMinute)
{
    /// <summary>平均值會在上限附近小幅浮動，差距在 0.5% 以內就視為滿載。</summary>
    public bool IsFull => FlowPerMinute >= CapacityPerMinute * 0.995;
}

/// <summary>整條產線對某一物品的實際總產出、總消耗與差額（正值為剩餘，負值為不足）。</summary>
public sealed record ProductBalance(string ProductId, double SupplyPerMinute, double DemandPerMinute)
{
    public double NetPerMinute => SupplyPerMinute - DemandPerMinute;
}

public sealed record SimulationSnapshot(
    double TimeSeconds,
    IReadOnlyList<NodeState> Nodes,
    IReadOnlyList<EdgeState> Edges,
    IReadOnlyList<ProductBalance> Balances);
