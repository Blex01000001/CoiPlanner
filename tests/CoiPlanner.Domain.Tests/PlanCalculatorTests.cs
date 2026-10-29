using CoiPlanner.Domain.Models;
using CoiPlanner.Domain.Services;
using static CoiPlanner.Domain.Tests.TestData;

namespace CoiPlanner.Domain.Tests;

public class PlanCalculatorTests
{
    private readonly PlanCalculator _calculator = new(Sample);

    private static ProductionPlan Plan(Node[] nodes, params Edge[] edges) => new() { Nodes = nodes, Edges = edges };

    [Fact]
    public void Calculate_EmptyPlan_IsValidWithNoBalances()
    {
        var result = _calculator.Calculate(new ProductionPlan());

        Assert.True(result.IsValid);
        Assert.Empty(result.Nodes);
        Assert.Empty(result.Balances);
    }

    [Fact]
    public void Calculate_NodeRates_ScaleByMachineCount()
    {
        var result = _calculator.Calculate(Plan([Furnace(count: 3)]));

        var node = Assert.Single(result.Nodes);
        Assert.Equal(new ProductRate("alpha_ore", 36), Assert.Single(node.Inputs));
        Assert.Equal(new ProductRate("beta_ingot", 18), Assert.Single(node.Outputs));
    }

    [Fact]
    public void Calculate_BalancedChain_HasZeroNetForIntermediate()
    {
        // 3 台熔爐產出 18 beta/分，2 台壓床消耗 18 beta/分
        var result = _calculator.Calculate(Plan(
            [Furnace(count: 3), Press(count: 2)],
            Link("f", "p", "beta_ingot")));

        Assert.True(result.IsValid);
        var beta = Assert.Single(result.Balances, b => b.ProductId == "beta_ingot");
        Assert.Equal(18, beta.SupplyPerMinute);
        Assert.Equal(18, beta.DemandPerMinute);
        Assert.Equal(0, beta.NetPerMinute);
    }

    [Fact]
    public void Calculate_Balances_ReportShortageAndSurplus()
    {
        var result = _calculator.Calculate(Plan([Furnace(count: 1), Press(count: 1)]));

        var beta = Assert.Single(result.Balances, b => b.ProductId == "beta_ingot");
        Assert.Equal(6 - 9, beta.NetPerMinute);
        var ore = Assert.Single(result.Balances, b => b.ProductId == "alpha_ore");
        Assert.Equal(-12, ore.NetPerMinute);
        var plate = Assert.Single(result.Balances, b => b.ProductId == "gamma_plate");
        Assert.Equal(6, plate.NetPerMinute);
    }

    [Fact]
    public void Calculate_DuplicateNodeId_ReportsIssueAndCountsOnce()
    {
        var result = _calculator.Calculate(Plan([Furnace("f"), Furnace("f")]));

        var issue = Assert.Single(result.Issues);
        Assert.Equal("f", issue.NodeId);
        Assert.Single(result.Nodes);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-2)]
    public void Calculate_NonPositiveCount_ReportsIssueAndSkipsNode(int count)
    {
        var result = _calculator.Calculate(Plan([Furnace(count: count)]));

        Assert.Contains("數量", Assert.Single(result.Issues).Message);
        Assert.Empty(result.Nodes);
    }

    [Fact]
    public void Calculate_UnknownMachineAndRecipe_ReportsBoth()
    {
        var node = new Node { Id = "x", MachineId = "nope", RecipeId = "nada", Count = 1 };

        var result = _calculator.Calculate(Plan([node]));

        Assert.Equal(2, result.Issues.Count);
        Assert.All(result.Issues, i => Assert.Equal("x", i.NodeId));
        Assert.Empty(result.Nodes);
    }

    [Fact]
    public void Calculate_MachineCannotRunRecipe_ReportsIssue()
    {
        var node = new Node { Id = "x", MachineId = "demo_press", RecipeId = "smelt_beta", Count = 1 };

        var result = _calculator.Calculate(Plan([node]));

        Assert.Contains("不能執行", Assert.Single(result.Issues).Message);
        Assert.Empty(result.Nodes);
    }

    [Fact]
    public void Calculate_EdgeToUnknownNode_ReportsIssueWithIndex()
    {
        var result = _calculator.Calculate(Plan([Furnace("f")], Link("f", "ghost", "beta_ingot")));

        var issue = Assert.Single(result.Issues);
        Assert.Equal(0, issue.EdgeIndex);
        Assert.Contains("'ghost'", issue.Message);
    }

    [Fact]
    public void Calculate_EdgeProductNotProducedBySourceOrUsedByTarget_ReportsBoth()
    {
        var result = _calculator.Calculate(Plan([Furnace("f"), Press("p")], Link("p", "f", "beta_ingot")));

        Assert.Contains(result.Issues, i => i.Message.Contains("不產出"));
        Assert.Contains(result.Issues, i => i.Message.Contains("不使用"));
    }

    [Fact]
    public void Calculate_EdgeWithUnknownProduct_ReportsIssue()
    {
        var result = _calculator.Calculate(Plan([Furnace("f"), Press("p")], Link("f", "p", "mystery")));

        Assert.Contains(result.Issues, i => i.Message.Contains("'mystery' 不存在"));
    }

    [Fact]
    public void Calculate_SelfLoopEdge_ReportsIssue()
    {
        var result = _calculator.Calculate(Plan([Furnace("f")], Link("f", "f", "beta_ingot")));

        Assert.Contains(result.Issues, i => i.Message.Contains("同一個節點"));
    }
}
