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
        Assert.All(Data.Products.Where(p => !p.Background), p => Assert.Contains(p.Kind!, kinds));
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

        var machine = Data.Machines.Single(m => m.Id == "thermal_desalinator");
        Assert.Equal(3, machine.RecipeIds.Count);
        Assert.Equal(400, machine.PowerUseKw);
        Assert.Equal(4, machine.Workers);
        Assert.Equal("維修I", machine.MaintenanceType);
        Assert.Equal(0.2, machine.MaintenancePerMinute);

        // 三種蒸汽各一種配方：超高壓 6、高壓 12、低壓 24
        var ultra = Recipe("desalinate_ultra_steam");
        Assert.Equal(new Dictionary<string, double> { ["seawater"] = 108, ["steam_ultra_high"] = 6 }, Amounts(ultra.Inputs));
        Assert.Equal(new Dictionary<string, double> { ["water"] = 72, ["brine"] = 42 }, Amounts(ultra.Outputs));

        var high = Recipe("desalinate");
        Assert.Equal(new Dictionary<string, double> { ["seawater"] = 108, ["steam_high"] = 12 }, Amounts(high.Inputs));
        Assert.Equal(new Dictionary<string, double> { ["water"] = 78, ["brine"] = 42 }, Amounts(high.Outputs));

        var low = Recipe("desalinate_low_steam");
        Assert.Equal(new Dictionary<string, double> { ["seawater"] = 72, ["low_steam"] = 24 }, Amounts(low.Inputs));
        Assert.Equal(new Dictionary<string, double> { ["water"] = 72, ["brine"] = 24 }, Amounts(low.Outputs));
        Assert.Equal("乏汽", Data.Products.Single(p => p.Id == "spent_gas").Name);
    }

    [Fact]
    public void Boilers_MatchUserData()
    {
        Assert.Equal("鍋爐", Data.Machines.Single(m => m.Id == "steam_boiler_coal").Name);
        var boiler = Data.Machines.Single(m => m.Id == "steam_boiler_coal");
        Assert.Equal(4, boiler.RecipeIds.Count);
        Assert.Equal(4, boiler.Workers);
        Assert.Equal(0, boiler.PowerUseKw);
        Assert.Equal(0, boiler.MaintenancePerMinute);
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

    [Fact]
    public void DieselGenerators_MatchUserData()
    {
        var g1 = Data.Machines.Single(m => m.Id == "diesel_generator_1");
        Assert.Equal(800, g1.PowerGenerationKw);
        Assert.Equal(new Dictionary<string, double> { ["diesel"] = 3 }, Amounts(RecipeOf("diesel_generator_1").Inputs));
        Assert.Equal(new Dictionary<string, double> { ["air_pollution"] = 3 }, Amounts(RecipeOf("diesel_generator_1").Outputs));

        var g2 = Data.Machines.Single(m => m.Id == "diesel_generator_2");
        Assert.Equal(5000, g2.PowerGenerationKw);
        Assert.Equal(new Dictionary<string, double> { ["diesel"] = 18 }, Amounts(RecipeOf("diesel_generator_2").Inputs));
        Assert.Equal(new Dictionary<string, double> { ["exhaust"] = 24 }, Amounts(RecipeOf("diesel_generator_2").Outputs));

        Assert.True(Data.Products.Single(p => p.Id == "air_pollution").Background);
    }

    [Fact]
    public void SeawaterPump_WorkersMaintenanceAndPower_MatchUserData()
    {
        var pump = Data.Machines.Single(m => m.Id == "seawater_pump");

        Assert.Equal(1, pump.Workers);
        Assert.Equal("維修I", pump.MaintenanceType);
        Assert.Equal(0.2, pump.MaintenancePerMinute);
        Assert.Equal(100, pump.PowerUseKw);
    }

    [Fact]
    public void EvaporationPond_MatchesUserData()
    {
        var pond = Data.Machines.Single(m => m.Id == "evaporation_pond_heated");
        Assert.Equal(6, pond.Workers);
        Assert.Equal(250, pond.PowerUseKw);
        Assert.Equal("維修I", pond.MaintenanceType);
        Assert.Equal(0.2, pond.MaintenancePerMinute);
        Assert.Equal(3, pond.RecipeIds.Count);

        Assert.Equal(new Dictionary<string, double> { ["seawater"] = 96 }, Amounts(Recipe("evaporate_seawater_brine").Inputs));
        Assert.Equal(new Dictionary<string, double> { ["brine"] = 48 }, Amounts(Recipe("evaporate_seawater_brine").Outputs));
        Assert.Equal(new Dictionary<string, double> { ["salt"] = 6 }, Amounts(Recipe("evaporate_seawater_salt").Outputs));
        Assert.Equal(new Dictionary<string, double> { ["brine"] = 96 }, Amounts(Recipe("evaporate_brine").Inputs));
        Assert.Equal(new Dictionary<string, double> { ["salt"] = 12 }, Amounts(Recipe("evaporate_brine").Outputs));
    }

    [Fact]
    public void Electrolyzer_MatchesUserData()
    {
        var machine = Data.Machines.Single(m => m.Id == "electrolyzer_2");
        Assert.Equal(3, machine.Workers);
        Assert.Equal(1100, machine.PowerUseKw);
        Assert.Equal("維修II", machine.MaintenanceType);
        Assert.Equal(0.9, machine.MaintenancePerMinute);

        Assert.Equal(new Dictionary<string, double> { ["brine"] = 72 }, Amounts(Recipe("electrolyze_brine").Inputs));
        Assert.Equal(new Dictionary<string, double> { ["chlorine"] = 48 }, Amounts(Recipe("electrolyze_brine").Outputs));

        var water = Recipe("electrolyze_water");
        Assert.Equal(new Dictionary<string, double> { ["water"] = 8 }, Amounts(water.Inputs));
        Assert.Equal(new Dictionary<string, double> { ["oxygen"] = 32, ["hydrogen"] = 16 }, Amounts(water.Outputs));
        Assert.Equal(4, water.PowerMultiplier);
        Assert.Equal(1, Recipe("electrolyze_brine").PowerMultiplier);

        var ammonia = Recipe("electrolyze_ammonia");
        Assert.Equal(new Dictionary<string, double> { ["ammonia"] = 48 }, Amounts(ammonia.Inputs));
        Assert.Equal(new Dictionary<string, double> { ["nitrogen"] = 96, ["hydrogen"] = 48 }, Amounts(ammonia.Outputs));
    }

    [Theory]
    [InlineData("distillation_1", 6, 1.4)]
    [InlineData("distillation_2", 8, 1.9)]
    [InlineData("distillation_3", 8, 2.8)]
    public void Distillation_WorkersAndMaintenance_MatchUserData(string id, double workers, double maintenance)
    {
        var machine = Data.Machines.Single(m => m.Id == id);

        Assert.Equal(workers, machine.Workers);
        Assert.Equal("維修I", machine.MaintenanceType);
        Assert.Equal(maintenance, machine.MaintenancePerMinute);
        Assert.Equal(0, machine.PowerUseKw);
    }

    private static void AssertRecipe(string id, Dictionary<string, double> inputs, Dictionary<string, double> outputs, double powerMultiplier = 1)
    {
        var r = Recipe(id);
        Assert.Equal(inputs, Amounts(r.Inputs));
        Assert.Equal(outputs, Amounts(r.Outputs));
        Assert.Equal(powerMultiplier, r.PowerMultiplier);
    }

    [Fact]
    public void CrackingUnit_MatchesUserData()
    {
        var m = Data.Machines.Single(x => x.Id == "cracking_unit");
        Assert.Equal((12, 160, "維修I", 2.8), (m.Workers, m.PowerUseKw, m.MaintenanceType, m.MaintenancePerMinute));
        Assert.Equal(6, m.RecipeIds.Count);

        AssertRecipe("crack_heavy_to_diesel", new() { ["heavy_oil"] = 24, ["hydrogen"] = 9 }, new() { ["diesel"] = 36, ["fuel_gas"] = 6 });
        AssertRecipe("crack_heavy_to_naphtha", new() { ["heavy_oil"] = 24, ["hydrogen"] = 9 }, new() { ["naphtha"] = 36, ["fuel_gas"] = 6 });
        AssertRecipe("crack_naphtha_to_diesel", new() { ["naphtha"] = 24, ["hydrogen"] = 9 }, new() { ["diesel"] = 24, ["fuel_gas"] = 6 });
        AssertRecipe("crack_diesel_to_naphtha", new() { ["diesel"] = 24, ["steam_high"] = 3 }, new() { ["naphtha"] = 18, ["fuel_gas"] = 6 });
        AssertRecipe("crack_naphtha_to_gas", new() { ["naphtha"] = 24, ["steam_high"] = 2 }, new() { ["fuel_gas"] = 24, ["hydrogen"] = 8 });
        AssertRecipe("crack_gas_to_diesel", new() { ["fuel_gas"] = 36, ["oxygen"] = 18 }, new() { ["diesel"] = 24, ["water"] = 6 });
    }

    [Fact]
    public void HydrogenReformer_MatchesUserData()
    {
        var m = Data.Machines.Single(x => x.Id == "hydrogen_reformer");
        Assert.Equal((8, 400, "維修I", 1.9), (m.Workers, m.PowerUseKw, m.MaintenanceType, m.MaintenancePerMinute));

        AssertRecipe("reform_hydrogen", new() { ["fuel_gas"] = 24, ["steam_high"] = 2 }, new() { ["hydrogen"] = 28, ["carbon_dioxide"] = 24 });
    }

    [Fact]
    public void ChemicalPlant_MatchesUserData()
    {
        var m = Data.Machines.Single(x => x.Id == "chemical_plant");
        Assert.Equal((8, 250, "維修I", 1.9), (m.Workers, m.PowerUseKw, m.MaintenanceType, m.MaintenancePerMinute));
        Assert.Equal(7, m.RecipeIds.Count);

        AssertRecipe("make_fertilizer", new() { ["ammonia"] = 12, ["oxygen"] = 18 }, new() { ["fertilizer_1"] = 30 });
        AssertRecipe("make_fertilizer_organic", new() { ["fertilizer_organic"] = 30, ["ammonia"] = 12, ["oxygen"] = 18 }, new() { ["fertilizer_1"] = 45 });
        AssertRecipe("synthesize_ammonia", new() { ["hydrogen"] = 6, ["nitrogen"] = 12 }, new() { ["ammonia"] = 6 }, powerMultiplier: 2);
        AssertRecipe("make_paper", new() { ["wood_chips"] = 6, ["lime"] = 1.5, ["steam_high"] = 1.5 }, new() { ["paper"] = 12 });
        AssertRecipe("make_diesel_biofuel", new() { ["ethanol"] = 7.5, ["edible_oil"] = 15 }, new() { ["diesel"] = 27 });
        AssertRecipe("make_graphite", new() { ["coal"] = 4, ["chlorine"] = 12 }, new() { ["graphite"] = 12, ["sour_water"] = 4 }, powerMultiplier: 2);
        AssertRecipe("make_disinfectant", new() { ["ethanol"] = 4.5, ["plastic_pellets"] = 3 }, new() { ["disinfectant"] = 12 });
        Assert.Equal("石灰石", Data.Products.Single(p => p.Id == "lime").Name);
    }

    [Fact]
    public void RecipeCost_EveryProductCalculates_WithFiniteCosts()
    {
        var calculator = new RecipeCostCalculator(Data);

        foreach (var id in calculator.TargetProductIds)
        {
            var report = calculator.Calculate(id);
            Assert.All(report.Routes, r => Assert.True(double.IsFinite(r.WeightedCost) && r.WeightedCost >= 0, $"{id} / {r.RecipeId}"));
            Assert.Equal(report.IsExternal, calculator.IsExternal(id));
        }
    }

    [Fact]
    public void RecipeCost_DieselViaDistillation_MatchesRecipeData()
    {
        var route = new RecipeCostCalculator(Data).Calculate("diesel").Routes.Single(r => r.RecipeId == "distill_medium_oil");

        // 蒸餾中油：中油 48 → 柴油 36，所以每柴油要 4/3 中油；蒸餾石油：石油 60 → 中油 48，所以每中油要 1.25 石油
        Assert.Equal(4.0 / 3 * 1.25, route.RawInputs.Single(a => a.ProductId == "crude_oil").Quantity, 6);
        // 輕油是蒸餾中油的副產品：30 / 36 每柴油；不計入成本
        Assert.Equal(30.0 / 36, route.Byproducts.Single(a => a.ProductId == "light_oil").Quantity, 6);
        Assert.DoesNotContain(route.RawInputs, a => a.ProductId == "light_oil");
    }

    [Fact]
    public void RecipeCost_MissingDataProducts_AreRawAndExternal()
    {
        var calculator = new RecipeCostCalculator(Data);

        Assert.True(calculator.IsExternal("wood_chips"));
        Assert.Contains("wood_chips", calculator.RawProductIds);
        Assert.False(calculator.IsExternal("water"));      // 有抽水配方
        Assert.True(calculator.IsRaw("water"));
        Assert.DoesNotContain("air_pollution", calculator.RawProductIds);
    }

    [Fact]
    public void RecipeCost_SameMachineWithDifferentRecipes_IsNotMerged()
    {
        // 柴油經「裂解石腦油」：石腦油又來自「裂解柴油」，兩個配方都由裂解裝置執行，必須分開列
        var route = new RecipeCostCalculator(Data).Calculate("diesel").Routes.Single(r => r.RecipeId == "crack_naphtha_to_diesel");

        var cracking = route.Machines.Where(m => m.MachineId == "cracking_unit").ToList();
        Assert.True(cracking.Count >= 2, "裂解裝置應該依配方分開列");
        Assert.Equal(cracking.Count, cracking.Select(m => m.RecipeId).Distinct().Count());
        Assert.Contains(cracking, m => m.RecipeId == "crack_naphtha_to_diesel");
        Assert.Contains(cracking, m => m.RecipeId == "crack_diesel_to_naphtha");
    }

    [Fact]
    public void Assembly_MechanicalParts_HasSteelAndIronPlateRecipes()
    {
        var machine = Data.Machines.Single(m => m.Id == "assembly_4");
        Assert.Contains("assemble_mechanical_parts", machine.RecipeIds);
        Assert.Contains("assemble_mechanical_parts_iron", machine.RecipeIds);

        AssertRecipe("assemble_mechanical_parts", new() { ["steel_plate"] = 24 }, new() { ["mechanical_parts"] = 48 });
        AssertRecipe("assemble_mechanical_parts_iron", new() { ["iron_plate"] = 60 }, new() { ["mechanical_parts"] = 48 });
    }

    [Fact]
    public void RecipeCost_MechanicalParts_ListsBothRoutes()
    {
        var report = new RecipeCostCalculator(Data).Calculate("mechanical_parts");

        Assert.Equal(2, report.Routes.Count);
        Assert.Contains(report.Routes, r => r.RecipeId == "assemble_mechanical_parts");
        Assert.Contains(report.Routes, r => r.RecipeId == "assemble_mechanical_parts_iron");
    }

    [Fact]
    public void AssemblyIV_StatsAndRecipeCount_MatchUserData()
    {
        var m = Data.Machines.Single(x => x.Id == "assembly_4");

        Assert.Equal((2, 250, "維修II", 1.9, 3), (m.Workers, m.PowerUseKw, m.MaintenanceType, m.MaintenancePerMinute, m.ComputingTf));
        Assert.Equal(37, m.RecipeIds.Count);
        Assert.Equal(m.RecipeIds.Count, m.RecipeIds.Distinct().Count());
        Assert.Equal("鋼", Data.Products.Single(p => p.Id == "steel_plate").Name);
    }

    [Fact]
    public void AssemblyIV_Recipes_MatchUserData()
    {
        AssertRecipe("assemble_building_parts_1_iron", new() { ["iron_plate"] = 36, ["wood"] = 36, ["concrete_slab"] = 48 }, new() { ["building_parts_1"] = 48 });
        AssertRecipe("assemble_building_parts_1_steel", new() { ["steel_plate"] = 24, ["wood"] = 24, ["concrete_slab"] = 36 }, new() { ["building_parts_1"] = 48 });
        AssertRecipe("assemble_building_parts_4", new() { ["building_parts_3"] = 12, ["electronics_2"] = 6 }, new() { ["building_parts_4"] = 6 });
        AssertRecipe("assemble_vehicle_parts_2", new() { ["vehicle_parts_1"] = 16, ["steel_plate"] = 8, ["glass"] = 4 }, new() { ["vehicle_parts_2"] = 8 });
        AssertRecipe("assemble_lab_equipment_4", new() { ["lab_equipment_3"] = 16, ["electronics_3"] = 2 }, new() { ["lab_equipment_4"] = 16 });
        AssertRecipe("assemble_electronics_1", new() { ["rubber"] = 8, ["copper_plate"] = 48 }, new() { ["electronics_1"] = 48 });
        AssertRecipe("assemble_electronics_2", new() { ["printed_circuit_board"] = 12, ["electronics_1"] = 24, ["polysilicon"] = 6 }, new() { ["electronics_2"] = 12 });
        AssertRecipe("assemble_medical_supplies_3", new() { ["medical_supplies_2"] = 48, ["anesthetic"] = 24, ["morphine"] = 24 }, new() { ["medical_supplies_3"] = 48 });
        AssertRecipe("assemble_packaged_food_tofu", new() { ["tofu"] = 24, ["vegetables"] = 32 }, new() { ["packaged_food"] = 16 });
        AssertRecipe("assemble_space_station_part_basic", new() { ["composite_core"] = 8, ["solar_cell"] = 4, ["chemical_fuel"] = 2 }, new() { ["space_station_part_basic"] = 4 });
        AssertRecipe("assemble_crew_rations", new() { ["packaged_food"] = 4, ["medical_supplies_2"] = 2, ["plastic_pellets"] = 2 }, new() { ["crew_rations"] = 8 });
    }

    [Fact]
    public void RecipeCost_CrewRations_ExpandsDeepChain()
    {
        var report = new RecipeCostCalculator(Data).Calculate("crew_rations");

        Assert.NotEmpty(report.Routes);
        Assert.All(report.Routes, r => Assert.True(double.IsFinite(r.WeightedCost) && r.WeightedCost > 0));
        // 抗生素、肉等沒有配方產出的物品視為外部輸入
        Assert.True(new RecipeCostCalculator(Data).IsExternal("antibiotics"));
    }
}
