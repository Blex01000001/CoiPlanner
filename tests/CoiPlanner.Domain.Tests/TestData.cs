using CoiPlanner.Domain.Models;

namespace CoiPlanner.Domain.Tests;

/// <summary>測試用的虛構資料，數值與 Data/sample.json 相同。</summary>
internal static class TestData
{
    public static GameData Sample { get; } = new()
    {
        Products =
        [
            new Product { Id = "alpha_ore", Name = "Alpha Ore", Unit = "pcs" },
            new Product { Id = "beta_ingot", Name = "Beta Ingot", Unit = "pcs" },
            new Product { Id = "gamma_plate", Name = "Gamma Plate", Unit = "pcs" },
            new Product { Id = "iron_ore", Name = "Iron Ore", Unit = "pcs" },
        ],
        Recipes =
        [
            new Recipe
            {
                Id = "smelt_beta", Name = "Smelt Beta Ingot", CycleSeconds = 10,
                Inputs = [new ItemAmount { ProductId = "alpha_ore", Quantity = 2 }],
                Outputs = [new ItemAmount { ProductId = "beta_ingot", Quantity = 1 }],
            },
            new Recipe
            {
                Id = "press_gamma", Name = "Press Gamma Plate", CycleSeconds = 20,
                Inputs = [new ItemAmount { ProductId = "beta_ingot", Quantity = 3 }],
                Outputs = [new ItemAmount { ProductId = "gamma_plate", Quantity = 2 }],
            },
        ],
        Machines =
        [
            new Machine { Id = "demo_furnace", Name = "Demo Furnace", RecipeIds = ["smelt_beta"] },
            new Machine { Id = "demo_press", Name = "Demo Press", RecipeIds = ["press_gamma"] },
        ],
    };

    public static Node Furnace(string id = "f", int count = 1) =>
        new() { Id = id, MachineId = "demo_furnace", RecipeId = "smelt_beta", Count = count };

    public static Node Press(string id = "p", int count = 1) =>
        new() { Id = id, MachineId = "demo_press", RecipeId = "press_gamma", Count = count };

    public static ResourceSource Source(string id, string productId, double ratePerMinute) =>
        new() { Id = id, ProductId = productId, RatePerMinute = ratePerMinute };

    public static Edge Link(string source, string target, string productId) =>
        new() { SourceNodeId = source, TargetNodeId = target, ProductId = productId, Transport = "belt" };
}
