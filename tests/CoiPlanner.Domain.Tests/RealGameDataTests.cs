using CoiPlanner.Domain.Models;
using CoiPlanner.Domain.Services;

namespace CoiPlanner.Domain.Tests;

/// <summary>檢查網站實際載入的 Data/*.json（使用者提供的遊戲資料）能通過驗證，且內容與使用者給的數字一致。</summary>
public class RealGameDataTests
{
    private static readonly GameData Data = new GameDataLoader().LoadFromDirectory(FindDataDirectory());

    /// <summary>從測試輸出資料夾往上找到專案根目錄的 Data 資料夾。</summary>
    private static string FindDataDirectory()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "Data");
            if (File.Exists(Path.Combine(candidate, "game.json")))
                return candidate;
        }
        throw new DirectoryNotFoundException("找不到 Data/game.json");
    }

    private static Recipe RecipeOf(string machineId) =>
        Data.Recipes.Single(r => r.Id == Data.Machines.Single(m => m.Id == machineId).RecipeIds.Single());

    private static Dictionary<string, double> Amounts(IEnumerable<ItemAmount> items) =>
        items.ToDictionary(i => i.ProductId, i => i.Quantity);

    [Fact]
    public void EveryProductHasATransport()
    {
        var kinds = Data.Transports.Select(t => t.Kind).ToHashSet();
        Assert.All(Data.Products, p => Assert.Contains(p.Kind!, kinds));
    }

    [Fact]
    public void EveryProductHasADistinctColor()
    {
        Assert.All(Data.Products, p => Assert.False(string.IsNullOrEmpty(p.Color), $"{p.Id} 沒有 color"));
        var duplicates = Data.Products.GroupBy(p => p.Color!.ToLowerInvariant()).Where(g => g.Count() > 1);
        Assert.Empty(duplicates.Select(g => $"{g.Key}: {string.Join(", ", g.Select(p => p.Id))}"));
    }

    // 以下檢查資料的結構，新增或刪除機器時不需要修改

    [Fact]
    public void EveryRecipeIsRunByAMachine()
    {
        var used = Data.Machines.SelectMany(m => m.RecipeIds).ToHashSet();
        Assert.All(Data.Recipes, r => Assert.Contains(r.Id, used));
    }

    [Fact]
    public void EveryProductAppearsInARecipe()
    {
        var used = Data.Recipes.SelectMany(r => r.Inputs.Concat(r.Outputs)).Select(i => i.ProductId).ToHashSet();
        Assert.All(Data.Products, p => Assert.Contains(p.Id, used));
    }

    [Fact]
    public void RemovedMachinesStayRemoved()
    {
        Assert.DoesNotContain(Data.Machines, m => m.Id is "iron_smelter" or "iron_caster");
        Assert.DoesNotContain(Data.Products, p => p.Id == "iron_ingot");
    }

    [Fact]
    public void BlastFurnace_MatchesUserData()
    {
        var recipe = RecipeOf("blast_furnace_2");

        Assert.Equal(60, recipe.CycleSeconds);
        Assert.Equal(new Dictionary<string, double> { ["crushed_iron_ore"] = 48, ["lime"] = 6, ["coal"] = 15 }, Amounts(recipe.Inputs));
        Assert.Equal(new Dictionary<string, double> { ["molten_iron"] = 48, ["slag"] = 18, ["exhaust"] = 36 }, Amounts(recipe.Outputs));
    }

    [Fact]
    public void DistillationChain_UsesHighPressureSteam()
    {
        Assert.Equal(6, Amounts(RecipeOf("distillation_1").Inputs)["steam_high"]);
        Assert.Equal(3, Amounts(RecipeOf("distillation_2").Inputs)["steam_high"]);
        Assert.Equal(3, Amounts(RecipeOf("distillation_3").Inputs)["steam_high"]);
    }

    [Fact]
    public void RecipesWithoutInputs_ProduceAtRate()
    {
        Assert.Equal(new Dictionary<string, double> { ["oxygen"] = 36, ["nitrogen"] = 36 }, Amounts(RecipeOf("air_separator").Outputs));
        Assert.Equal(60, Amounts(RecipeOf("oil_well").Outputs)["crude_oil"]);
        Assert.Equal(60, Amounts(RecipeOf("lime_quarry").Outputs)["lime"]);
        Assert.Empty(RecipeOf("air_separator").Inputs);
    }

    private static Recipe Recipe(string id) => Data.Recipes.Single(r => r.Id == id);

    [Fact]
    public void EveryMachineHasACategory()
    {
        Assert.All(Data.Machines, m => Assert.False(string.IsNullOrWhiteSpace(m.Category), $"{m.Id} 沒有 category"));
        Assert.NotEqual("其他", Data.Machines.Single(m => m.Id == "thermal_desalinator").Category);
    }

    [Fact]
    public void SeawaterAndDesalinator_MatchUserData()
    {
        Assert.Equal(new Dictionary<string, double> { ["seawater"] = 108 }, Amounts(RecipeOf("seawater_pump").Outputs));
        var d = RecipeOf("thermal_desalinator");
        Assert.Equal(new Dictionary<string, double> { ["seawater"] = 108, ["steam_high"] = 12 }, Amounts(d.Inputs));
        Assert.Equal(new Dictionary<string, double> { ["water"] = 78, ["brine"] = 42 }, Amounts(d.Outputs));
    }

    [Fact]
    public void Boilers_MatchUserData()
    {
        Assert.Equal("鍋爐", Data.Machines.Single(m => m.Id == "steam_boiler_coal").Name);
        Assert.Equal(4, Data.Machines.Single(m => m.Id == "steam_boiler_coal").RecipeIds.Count);
        Assert.Equal(7, Data.Machines.Single(m => m.Id == "boiler_gas").RecipeIds.Count);

        var coal = Recipe("boil_steam_coal");
        Assert.Equal(new Dictionary<string, double> { ["water"] = 48, ["coal"] = 30 }, Amounts(coal.Inputs));
        Assert.Equal(new Dictionary<string, double> { ["steam_high"] = 48, ["exhaust"] = 60 }, Amounts(coal.Outputs));

        var hydrogen = Recipe("boil_steam_hydrogen");
        Assert.Equal(new Dictionary<string, double> { ["water"] = 48, ["hydrogen"] = 72 }, Amounts(hydrogen.Inputs));
        Assert.Equal(new Dictionary<string, double> { ["steam_high"] = 48, ["spent_gas"] = 36 }, Amounts(hydrogen.Outputs));

        var electric = RecipeOf("boiler_electric");
        Assert.Equal(new Dictionary<string, double> { ["water"] = 12 }, Amounts(electric.Inputs));
        Assert.Equal(new Dictionary<string, double> { ["steam_high"] = 12 }, Amounts(electric.Outputs));
    }
}
