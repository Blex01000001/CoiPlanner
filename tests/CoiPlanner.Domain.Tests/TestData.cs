using CoiPlanner.Domain.Models;
using CoiPlanner.Domain.Services;

namespace CoiPlanner.Domain.Tests;

/// <summary>測試用的虛構資料，唯一來源是 Fixtures/sample.json；這裡只提供建立節點與連線的捷徑。</summary>
internal static class TestData
{
    public static GameData Sample { get; } =
        new GameDataLoader().LoadFromFile(Path.Combine(AppContext.BaseDirectory, "Fixtures", "sample.json"));

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
