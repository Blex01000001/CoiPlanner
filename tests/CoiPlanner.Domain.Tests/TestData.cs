using CoiPlanner.Domain.Models;

namespace CoiPlanner.Domain.Tests;

/// <summary>測試用的虛構資料，數值與 Fixtures/sample.json 相同。</summary>
internal static class TestData
{
    public static GameData Sample { get; } = new()
    {
        Products =
        [
            new Product { Id = "alpha_ore", Name = "Alpha Ore", Unit = "pcs", Kind = "unit" },
            new Product { Id = "beta_ingot", Name = "Beta Ingot", Unit = "pcs", Kind = "unit" },
            new Product { Id = "gamma_plate", Name = "Gamma Plate", Unit = "pcs", Kind = "unit" },
            new Product { Id = "iron_ore", Name = "Iron Ore", Unit = "pcs", Kind = "unit" },
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
        Transports =
        [
            new Transport { Id = "belt", Name = "Demo Belt", Kind = "unit", TiersPerMinute = [10, 100] },
            new Transport { Id = "pipe", Name = "Demo Pipe", Kind = "fluid", TiersPerMinute = [50] },
        ],
    };

    public static Node Furnace(string id = "f", int count = 1) =>
        new() { Id = id, MachineId = "demo_furnace", RecipeId = "smelt_beta", Count = count };

    public static Node Press(string id = "p", int count = 1) =>
        new() { Id = id, MachineId = "demo_press", RecipeId = "press_gamma", Count = count };

    public static ResourceSource Source(string id, string productId, double ratePerMinute) =>
        new() { Id = id, ProductId = productId, RatePerMinute = ratePerMinute };

    /// <summary>預設用二級輸送帶（每分鐘 100），容量足夠，不影響只測速率的測試。</summary>
    public static Edge Link(string source, string target, string productId, string transport = "belt", int tier = 2) =>
        new() { SourceNodeId = source, TargetNodeId = target, ProductId = productId, Transport = transport, Tier = tier };
}
