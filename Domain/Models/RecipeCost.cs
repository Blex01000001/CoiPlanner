namespace CoiPlanner.Domain.Models;

/// <summary>某一物品的數量（單位依用途而定，見各欄位的說明）。</summary>
public sealed record ProductAmount(string ProductId, double Quantity);

/// <summary>維持 1 單位/分目標產量需要的機器台數（可能是小數，代表機器的使用比例）。</summary>
public sealed record MachineNeed(string MachineId, double Count);

/// <summary>某一種維修每分鐘的需求量。</summary>
public sealed record MaintenanceNeed(string Type, double PerMinute);

/// <summary>展開時，某個中間物品選用了哪個配方（取加權成本最低的）。</summary>
public sealed record UpstreamStep(string ProductId, string RecipeId);

/// <summary>
/// 用某一個配方生產目標物品的成本，全部換算成「每 1 單位目標物品」（速率單位是每分鐘，所以也是維持 1 單位/分的需求）。
/// 副產品的原料成本全部算在目標物品上，不分攤也不抵扣。
/// </summary>
/// <param name="RecipeId">直接產出目標物品的配方。</param>
/// <param name="RawInputs">每 1 單位目標需要的原料（含外部輸入）。</param>
/// <param name="Byproducts">整條展開過程中，每 1 單位目標額外產出的其他物品（含背景統計值），不計入成本。</param>
/// <param name="WeightedCost">原料用量乘上權重的總和。</param>
/// <param name="Machines">維持 1 單位/分需要的機器。</param>
/// <param name="PowerKw">維持 1 單位/分需要的耗電（kW，已含配方耗電倍率）。</param>
/// <param name="Workers">維持 1 單位/分需要的工人。</param>
/// <param name="Maintenance">維持 1 單位/分每分鐘需要的維修，依種類。</param>
/// <param name="Steps">展開時中間物品選用的配方。</param>
/// <param name="Warnings">展開時遇到的問題（循環、沒有可行做法而視為外部輸入）。</param>
public sealed record RouteCost(
    string RecipeId,
    IReadOnlyList<ProductAmount> RawInputs,
    IReadOnlyList<ProductAmount> Byproducts,
    double WeightedCost,
    IReadOnlyList<MachineNeed> Machines,
    double PowerKw,
    double Workers,
    IReadOnlyList<MaintenanceNeed> Maintenance,
    IReadOnlyList<UpstreamStep> Steps,
    IReadOnlyList<string> Warnings);

/// <summary>某個目標物品的成本比較：每個能直接產出它的配方一列，依加權成本由低到高排序。</summary>
public sealed record CostReport(string ProductId, IReadOnlyList<RouteCost> Routes)
{
    /// <summary>沒有任何配方產出（資料缺少），視為外部輸入。</summary>
    public bool IsExternal => Routes.Count == 0;
}
