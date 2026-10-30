using CoiPlanner.Domain.Models;
using CoiPlanner.Domain.Services;
using static CoiPlanner.Domain.Tests.TestData;

namespace CoiPlanner.Domain.Tests;

public class PlanCalculatorSourceTests
{
    private readonly PlanCalculator _calculator = new(Sample);

    private static ProductionPlan Plan(Node[] nodes, ResourceSource[] sources, params Edge[] edges) =>
        new() { Nodes = nodes, Sources = sources, Edges = edges };

    [Fact]
    public void Calculate_Source_RatedOutputIsItsRate()
    {
        var result = _calculator.Calculate(Plan([], [Source("s", "iron_ore", 120)]));

        Assert.True(result.IsValid);
        var node = Assert.Single(result.Nodes);
        Assert.Empty(node.Inputs);
        Assert.Equal(new ProductRate("iron_ore", 120), Assert.Single(node.Outputs));
    }

    [Fact]
    public void Calculate_SourceFeedingMachine_IsValid()
    {
        // 1 台熔爐消耗 alpha_ore 12/分
        var result = _calculator.Calculate(Plan(
            [Furnace("f")],
            [Source("s", "alpha_ore", 12)],
            Link("s", "f", "alpha_ore")));

        Assert.True(result.IsValid);
        Assert.Equal([100.0], result.EdgeCapacities);
    }

    [Fact]
    public void Calculate_ZeroRateSource_IsValid()
    {
        var result = _calculator.Calculate(Plan([], [Source("s", "iron_ore", 0)]));

        Assert.True(result.IsValid);
    }

    [Fact]
    public void Calculate_NegativeRate_ReportsIssueAndSkipsSource()
    {
        var result = _calculator.Calculate(Plan([], [Source("s", "iron_ore", -5)]));

        var issue = Assert.Single(result.Issues);
        Assert.Equal("s", issue.NodeId);
        Assert.Empty(result.Nodes);
    }

    [Fact]
    public void Calculate_UnknownProduct_ReportsIssue()
    {
        var result = _calculator.Calculate(Plan([], [Source("s", "unobtainium", 10)]));

        Assert.Contains("'unobtainium'", Assert.Single(result.Issues).Message);
    }

    [Fact]
    public void Calculate_SourceIdClashesWithNode_ReportsDuplicate()
    {
        var result = _calculator.Calculate(Plan([Furnace("x")], [Source("x", "iron_ore", 10)]));

        Assert.Contains("重複", Assert.Single(result.Issues).Message);
    }

    [Fact]
    public void Calculate_EdgeFromSourceWithWrongProduct_ReportsIssue()
    {
        var result = _calculator.Calculate(Plan(
            [Furnace("f")],
            [Source("s", "iron_ore", 10)],
            Link("s", "f", "alpha_ore")));

        Assert.Contains(result.Issues, i => i.EdgeIndex == 0 && i.Message.Contains("不產出"));
    }

    [Fact]
    public void Calculate_EdgeIntoSource_ReportsIssue()
    {
        var result = _calculator.Calculate(Plan(
            [Furnace("f")],
            [Source("s", "beta_ingot", 10)],
            Link("f", "s", "beta_ingot")));

        Assert.Contains(result.Issues, i => i.EdgeIndex == 0 && i.Message.Contains("不使用"));
    }
}
