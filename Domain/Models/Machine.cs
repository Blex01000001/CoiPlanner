namespace CoiPlanner.Domain.Models;

/// <summary>機器類型，以及它能執行的配方。</summary>
public sealed record Machine
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    /// <summary>右鍵選單「新增節點」的第一層分類。</summary>
    public string Category { get; init; } = "其他";
    /// <summary>單台機器運轉時的耗電（kW）。電力不是物品，不走連線，只在整張規劃上做供需平衡。</summary>
    public double PowerUseKw { get; init; }

    /// <summary>單台機器全速運轉時的發電量（kW）。</summary>
    public double PowerGenerationKw { get; init; }

    /// <summary>單台機器需要的算力（TF）。目前只記錄資料並顯示在資料瀏覽頁，還沒有納入檢查或模擬。</summary>
    public double ComputingTf { get; init; }

    /// <summary>單台機器需要的工人數。目前只記錄資料，還沒有納入檢查或模擬。</summary>
    public double Workers { get; init; }

    /// <summary>單台機器使用的維修種類，例如「維修I」；不需要維修時為空。</summary>
    public string? MaintenanceType { get; init; }

    /// <summary>單台機器每分鐘消耗的維修量（種類見 <see cref="MaintenanceType"/>）。目前只記錄資料。</summary>
    public double MaintenancePerMinute { get; init; }

    public IReadOnlyList<string> RecipeIds { get; init; } = [];

    public bool CanRun(string recipeId) => RecipeIds.Contains(recipeId);
}
