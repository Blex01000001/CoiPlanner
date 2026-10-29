using System.Text.Json;
using CoiPlanner.Domain.Models;

namespace CoiPlanner.Domain.Services;

/// <summary>產線規劃與 JSON 之間的轉換。內容是否合理由 <see cref="PlanCalculator"/> 檢查。</summary>
public sealed class ProductionPlanSerializer
{
    public string Serialize(ProductionPlan plan) => JsonSerializer.Serialize(plan, JsonDefaults.Options);

    public ProductionPlan Deserialize(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<ProductionPlan>(json, JsonDefaults.Options)
                ?? throw new GameDataException("規劃 JSON 內容為空。");
        }
        catch (JsonException ex)
        {
            throw new GameDataException($"規劃 JSON 格式錯誤：{ex.Message}", ex);
        }
    }
}
