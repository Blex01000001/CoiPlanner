using CoiPlanner.Domain.Models;
using CoiPlanner.Domain.Services;
using static CoiPlanner.Domain.Tests.TestData;

namespace CoiPlanner.Domain.Tests;

/// <summary>
/// 測試資料（每分鐘）：熔爐 alpha_ore 12 → beta_ingot 6；壓床 beta_ingot 9 → gamma_plate 6（每台工人 2、維修 M1 0.5）；
/// 備用壓床配方 beta_ingot 6 → gamma_plate 3＋smog 3；alpha_ore 由鑽機採集（每台 150 kW、產 12）；
/// reforge_gamma 用 2 個 gamma_plate＋1 個 alpha_ore 產出 3 個 gamma_plate（自己需要自己，循環）；
/// make_delta／make_epsilon 互相需要，沒有原料可以起頭。
/// </summary>
public class RecipeCostCalculatorTests
{
    private readonly RecipeCostCalculator _calculator = new(Sample);

    private static void Near(double expected, double actual, double tolerance = 1e-6) =>
        Assert.InRange(actual, expected - tolerance, expected + tolerance);

    private static double Amount(IEnumerable<ProductAmount> list, string productId) =>
        list.Where(a => a.ProductId == productId).Sum(a => a.Quantity);

    private static RouteCost Route(CostReport report, string recipeId) => report.Routes.Single(r => r.RecipeId == recipeId);

    [Fact]
    public void RawAndExternalProducts_AreClassified()
    {
        Assert.True(_calculator.IsRaw("alpha_ore"));       // 鑽機是沒有輸入的配方
        Assert.False(_calculator.IsExternal("alpha_ore"));
        Assert.True(_calculator.IsRaw("iron_ore"));        // 沒有任何配方產出
        Assert.True(_calculator.IsExternal("iron_ore"));
        Assert.False(_calculator.IsRaw("beta_ingot"));
        Assert.Contains("alpha_ore", _calculator.RawProductIds);
        Assert.Contains("iron_ore", _calculator.RawProductIds);
        Assert.DoesNotContain("beta_ingot", _calculator.RawProductIds);
        Assert.DoesNotContain("smog", _calculator.TargetProductIds);   // 背景統計值不能當目標
    }

    [Fact]
    public void Routes_ListEveryRecipeSortedByWeightedCost()
    {
        var report = _calculator.Calculate("gamma_plate");

        // 壓床：beta 1.5/gamma → alpha 3/gamma；備用配方：beta 2/gamma → alpha 4/gamma；
        // 重鑄：循環，gamma 的最低成本逼近 1（每多 1 個 gamma 只需要 1 個 alpha），所以最便宜
        Assert.Equal(["reforge_gamma", "press_gamma", "press_gamma_alt"], report.Routes.Select(r => r.RecipeId));
        Near(3, Amount(Route(report, "press_gamma").RawInputs, "alpha_ore"));
        Near(3, Route(report, "press_gamma").WeightedCost);
        Near(4, Amount(Route(report, "press_gamma_alt").RawInputs, "alpha_ore"));
        Near(4, Route(report, "press_gamma_alt").WeightedCost);
    }

    [Fact]
    public void SelfCycle_ChargesTheLoopedProductAtItsCheapestCost_AndWarns()
    {
        var route = Route(_calculator.Calculate("gamma_plate"), "reforge_gamma");

        // 每 1 gamma：2/3 個 gamma（循環，視為外部輸入）＋ 1/3 個 alpha；gamma 計價 1 → 2/3 + 1/3 = 1
        Near(2.0 / 3, Amount(route.RawInputs, "gamma_plate"));
        Near(1.0 / 3, Amount(route.RawInputs, "alpha_ore"));
        Near(1, route.WeightedCost, 1e-6);
        Assert.Contains(route.Warnings, w => w.Contains("循環") && w.Contains("Gamma Plate"));
    }

    [Fact]
    public void Weights_ChangeTheCostAndTheOrder()
    {
        var weights = new Dictionary<string, double> { ["alpha_ore"] = 2.5 };

        var report = _calculator.Calculate("gamma_plate", weights);

        Near(7.5, Route(report, "press_gamma").WeightedCost);
        Near(10, Route(report, "press_gamma_alt").WeightedCost);
        Near(2.5, Route(report, "reforge_gamma").WeightedCost, 1e-6);   // 循環的最低成本跟著 alpha 的權重走
        Near(3, Amount(Route(report, "press_gamma").RawInputs, "alpha_ore"));   // 用量不受權重影響
    }

    [Fact]
    public void MachinePowerWorkersAndMaintenance_PerUnitPerMinute()
    {
        var route = Route(_calculator.Calculate("gamma_plate"), "press_gamma");

        // 每 1 單位/分 gamma：壓床 1/6 台、熔爐 0.25 台、鑽機 0.25 台
        var machines = route.Machines.ToDictionary(m => (m.MachineId, m.RecipeId), m => m.Count);
        Near(1.0 / 6, machines[("demo_press", "press_gamma")]);
        Near(0.25, machines[("demo_furnace", "smelt_beta")]);
        Near(0.25, machines[("demo_drill", "mine_alpha")]);
        Assert.Equal(3, machines.Count);
        Near(0.25 * 150, route.PowerKw);                  // 只有鑽機耗電（含採集原料的機器）
        Near(2.0 / 6, route.Workers);
        var maintenance = Assert.Single(route.Maintenance);
        Assert.Equal("M1", maintenance.Type);
        Near(0.5 / 6, maintenance.PerMinute);
    }

    [Fact]
    public void Steps_NameTheRecipeChosenForEachIntermediate()
    {
        var route = Route(_calculator.Calculate("gamma_plate"), "press_gamma");

        var step = Assert.Single(route.Steps);
        Assert.Equal(new UpstreamStep("beta_ingot", "smelt_beta"), step);
    }

    [Fact]
    public void Byproducts_AreListedPerUnit_AndNotCountedInCost()
    {
        var report = _calculator.Calculate("gamma_plate");

        Assert.Empty(Route(report, "press_gamma").Byproducts);
        var alt = Route(report, "press_gamma_alt");
        Near(1, Amount(alt.Byproducts, "smog"));          // 每 1 gamma 多 1 smog
        Assert.DoesNotContain(alt.RawInputs, r => r.ProductId == "smog");
    }

    [Fact]
    public void ExtractionRecipeAsTarget_IsItsOwnRaw()
    {
        // 目標本身就是原料：兩種採集配方各一列，每 1 單位目標就是 1 單位原料
        var report = _calculator.Calculate("alpha_ore");

        Assert.Equal(2, report.Routes.Count);
        Assert.All(report.Routes, r => Near(1, Amount(r.RawInputs, "alpha_ore")));
        // 每台鑽機產 12/分、耗電 150 kW：每 1 單位/分需要 1/12 台；快速配方的耗電是 4 倍
        Near(150.0 / 12, report.Routes.Single(r => r.RecipeId == "mine_alpha").PowerKw);
        Near(150.0 * 4 / 12, report.Routes.Single(r => r.RecipeId == "mine_alpha_fast").PowerKw);
    }

    [Fact]
    public void ProductWithoutRecipes_IsExternalAndHasNoRoutes()
    {
        var report = _calculator.Calculate("iron_ore");

        Assert.True(report.IsExternal);
        Assert.Empty(report.Routes);
    }

    [Fact]
    public void Cycle_DoesNotLoopForever_AndWarns()
    {
        // delta 需要 epsilon，epsilon 又需要 delta，沒有原料可以起頭
        var report = _calculator.Calculate("delta");

        var route = Assert.Single(report.Routes);
        Assert.Contains(route.Warnings, w => w.Contains("Epsilon"));
        Assert.True(Amount(route.RawInputs, "epsilon") > 0);   // 視為外部輸入
        Assert.True(double.IsFinite(route.WeightedCost));
    }

    [Fact]
    public void NegativeWeights_AreTreatedAsZero()
    {
        var report = _calculator.Calculate("gamma_plate", new Dictionary<string, double> { ["alpha_ore"] = -5 });

        Assert.All(report.Routes, r => Assert.Equal(0, r.WeightedCost));
    }
}
