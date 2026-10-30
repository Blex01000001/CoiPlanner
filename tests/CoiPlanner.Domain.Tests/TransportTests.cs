using CoiPlanner.Domain.Models;
using CoiPlanner.Domain.Services;
using static CoiPlanner.Domain.Tests.TestData;

namespace CoiPlanner.Domain.Tests;

public class TransportLoaderTests
{
    private readonly GameDataLoader _loader = new();

    private static string SamplePath => Path.Combine(AppContext.BaseDirectory, "Fixtures", "sample.json");

    [Fact]
    public void LoadFromFile_SampleJson_MapsTransports()
    {
        var data = _loader.LoadFromFile(SamplePath);

        Assert.Equal(2, data.Transports.Count);
        var belt = Assert.Single(data.Transports, t => t.Id == "belt");
        Assert.Equal("unit", belt.Kind);
        Assert.Equal([10, 100], belt.TiersPerMinute);
        Assert.All(data.Products, p => Assert.Equal("unit", p.Kind));
    }

    [Fact]
    public void CapacityPerMinute_TierIsOneBased()
    {
        var belt = Sample.Transports.Single(t => t.Id == "belt");

        Assert.Equal(10, belt.CapacityPerMinute(1));
        Assert.Equal(100, belt.CapacityPerMinute(2));
        Assert.Null(belt.CapacityPerMinute(0));
        Assert.Null(belt.CapacityPerMinute(3));
    }

    [Fact]
    public void Parse_TwoTransportsForOneKind_Throws()
    {
        const string json = """
            { "transports": [
                { "id": "a", "name": "A", "kind": "fluid", "tiersPerMinute": [ 1 ] },
                { "id": "b", "name": "B", "kind": "fluid", "tiersPerMinute": [ 1 ] } ] }
            """;

        var ex = Assert.Throws<GameDataException>(() => _loader.Parse(json));
        Assert.Contains("'fluid'", ex.Message);
    }

    [Fact]
    public void Parse_DuplicateTransportId_Throws()
    {
        const string json = """
            { "transports": [
                { "id": "a", "name": "A", "kind": "fluid", "tiersPerMinute": [ 1 ] },
                { "id": "a", "name": "A2", "kind": "unit", "tiersPerMinute": [ 1 ] } ] }
            """;

        var ex = Assert.Throws<GameDataException>(() => _loader.Parse(json));
        Assert.Contains("transport id 'a'", ex.Message);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("[ 60, 0 ]")]
    [InlineData("[ -1 ]")]
    public void Parse_InvalidTiers_Throws(string tiers)
    {
        var json = $$"""
            { "transports": [ { "id": "a", "name": "A", "kind": "fluid", "tiersPerMinute": {{tiers}} } ] }
            """;

        var ex = Assert.Throws<GameDataException>(() => _loader.Parse(json));
        Assert.Contains("transport 'a'", ex.Message);
    }

    [Fact]
    public void Parse_ProductKindWithoutTransport_Throws()
    {
        const string json = """
            { "products": [ { "id": "w", "name": "W", "unit": "pcs", "kind": "fluid" } ] }
            """;

        var ex = Assert.Throws<GameDataException>(() => _loader.Parse(json));
        Assert.Contains("'fluid'", ex.Message);
    }
}

public class PlanCalculatorTransportTests
{
    private readonly PlanCalculator _calculator = new(Sample);

    private static ProductionPlan Plan(Node[] nodes, ResourceSource[] sources, params Edge[] edges) =>
        new() { Nodes = nodes, Sources = sources, Edges = edges };

    [Fact]
    public void Calculate_Edge_CarriesTargetDemand()
    {
        // 熔爐需要 alpha_ore 12/分，來源有 30/分，二級輸送帶上限 100
        var result = _calculator.Calculate(Plan([Furnace("f")], [Source("s", "alpha_ore", 30)], Link("s", "f", "alpha_ore")));

        Assert.True(result.IsValid);
        var edge = Assert.Single(result.Edges);
        Assert.Equal(new EdgeResult(0, 12, 100), edge);
        Assert.False(edge.IsFull);
    }

    [Fact]
    public void Calculate_Edge_LimitedByCapacity_IsFull()
    {
        // 一級輸送帶上限 10，需求 12
        var result = _calculator.Calculate(Plan([Furnace("f")], [Source("s", "alpha_ore", 30)], Link("s", "f", "alpha_ore", tier: 1)));

        var edge = Assert.Single(result.Edges);
        Assert.Equal(10, edge.FlowPerMinute);
        Assert.Equal(10, edge.CapacityPerMinute);
        Assert.True(edge.IsFull);
    }

    [Fact]
    public void Calculate_Edge_LimitedBySupply()
    {
        var result = _calculator.Calculate(Plan([Furnace("f")], [Source("s", "alpha_ore", 5)], Link("s", "f", "alpha_ore")));

        Assert.Equal(5, Assert.Single(result.Edges).FlowPerMinute);
    }

    [Fact]
    public void Calculate_OneSourceManyTargets_FillsInOrder()
    {
        // 20/分 分給兩台各需 12/分的熔爐：第一條先填滿 12，第二條拿剩下的 8
        var result = _calculator.Calculate(Plan(
            [Furnace("f1"), Furnace("f2")],
            [Source("s", "alpha_ore", 20)],
            Link("s", "f1", "alpha_ore"),
            Link("s", "f2", "alpha_ore")));

        Assert.Equal([12.0, 8.0], result.Edges.Select(e => e.FlowPerMinute));
    }

    [Fact]
    public void Calculate_ManySourcesOneTarget_FillsInOrder()
    {
        // 兩個 10/分 的來源合流到需要 12/分 的熔爐：第一條 10，第二條補 2
        var result = _calculator.Calculate(Plan(
            [Furnace("f")],
            [Source("a", "alpha_ore", 10), Source("b", "alpha_ore", 10)],
            Link("a", "f", "alpha_ore"),
            Link("b", "f", "alpha_ore")));

        Assert.Equal([10.0, 2.0], result.Edges.Select(e => e.FlowPerMinute));
    }

    [Fact]
    public void Calculate_MachineToMachine_UsesRatedOutput()
    {
        // 熔爐額定產出 beta_ingot 6/分，壓床需要 9/分
        var result = _calculator.Calculate(Plan([Furnace("f"), Press("p")], [], Link("f", "p", "beta_ingot")));

        Assert.Equal(6, Assert.Single(result.Edges).FlowPerMinute);
    }

    [Fact]
    public void Calculate_WrongTransport_ReportsIssueAndNoFlow()
    {
        var result = _calculator.Calculate(Plan([Furnace("f")], [Source("s", "alpha_ore", 30)], Link("s", "f", "alpha_ore", transport: "pipe", tier: 1)));

        var issue = Assert.Single(result.Issues);
        Assert.Equal(0, issue.EdgeIndex);
        Assert.Contains("Demo Belt", issue.Message);
        Assert.Equal(new EdgeResult(0, 0, null), Assert.Single(result.Edges));
    }

    [Fact]
    public void Calculate_EmptyTransport_ReportsNotSpecified()
    {
        var result = _calculator.Calculate(Plan([Furnace("f")], [Source("s", "alpha_ore", 30)], Link("s", "f", "alpha_ore", transport: "")));

        Assert.Contains("未指定", Assert.Single(result.Issues).Message);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(3)]
    public void Calculate_TierOutOfRange_ReportsIssue(int tier)
    {
        var result = _calculator.Calculate(Plan([Furnace("f")], [Source("s", "alpha_ore", 30)], Link("s", "f", "alpha_ore", tier: tier)));

        Assert.Contains($"{tier} 級", Assert.Single(result.Issues).Message);
        Assert.Null(Assert.Single(result.Edges).CapacityPerMinute);
    }

    [Fact]
    public void Calculate_ProductWithoutKind_ReportsIssue()
    {
        var data = Sample with
        {
            Products = Sample.Products.Select(p => p.Id == "alpha_ore" ? p with { Kind = null } : p).ToList(),
        };
        var result = new PlanCalculator(data).Calculate(Plan([Furnace("f")], [Source("s", "alpha_ore", 30)], Link("s", "f", "alpha_ore")));

        Assert.Contains("沒有對應的運輸方式", Assert.Single(result.Issues).Message);
    }

    [Fact]
    public void Calculate_EdgeToUnknownNode_HasNoFlow()
    {
        var result = _calculator.Calculate(Plan([], [Source("s", "alpha_ore", 30)], Link("s", "missing", "alpha_ore")));

        Assert.False(result.IsValid);
        Assert.Equal(new EdgeResult(0, 0, null), Assert.Single(result.Edges));
    }

    [Fact]
    public void Deserialize_EdgeWithoutTier_DefaultsToTierOne()
    {
        const string json = """
            { "edges": [ { "sourceNodeId": "s", "targetNodeId": "f", "productId": "alpha_ore", "transport": "belt" } ] }
            """;

        Assert.Equal(1, Assert.Single(new ProductionPlanSerializer().Deserialize(json).Edges).Tier);
    }
}
