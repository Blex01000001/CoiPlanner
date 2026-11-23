using CoiPlanner.Domain.Models;
using CoiPlanner.Domain.Services;
using static CoiPlanner.Domain.Tests.TestData;

namespace CoiPlanner.Domain.Tests;

/// <summary>
/// 電力：鑽機（demo_drill）每台耗電 150 kW、產出 alpha_ore 12/分；發電機（demo_generator）每台發 200 kW、
/// 全速時每分鐘燒 6 個 alpha_ore。
/// </summary>
public class PowerTests
{
    private static PlanResult Check(ProductionPlan plan) => new PlanCalculator(Sample).Calculate(plan);

    private static ProductionSimulator Simulate(ProductionPlan plan)
    {
        var sim = new ProductionSimulator();
        sim.Sync(plan, Check(plan));
        return sim;
    }

    private static void Near(double expected, double actual, double tolerance = 0.05) =>
        Assert.InRange(actual, expected - tolerance, expected + tolerance);

    /// <summary>發電機由資源直接供應燃料；count 台鑽機。</summary>
    private static ProductionPlan Plan(int generators, int drills, double fuelPerMinute = 100) => new()
    {
        Nodes = [Generator("g", generators), Drill("d", drills)],
        Sources = [Source("s", "alpha_ore", fuelPerMinute)],
        Edges = [Link("s", "g", "alpha_ore")],
    };

    [Fact]
    public void Calculator_SumsPowerByCount()
    {
        var result = Check(Plan(generators: 2, drills: 2));

        Assert.Equal(300, result.PowerUseKw);
        Assert.Equal(400, result.PowerGenerationKw);
        Assert.True(result.IsValid);
    }

    [Fact]
    public void Calculator_ReportsShortage_WithoutNodeId()
    {
        var result = Check(Plan(generators: 1, drills: 2));

        var issue = Assert.Single(result.Issues);
        Assert.Contains("電力不足", issue.Message);
        Assert.Null(issue.NodeId);
        Assert.Null(issue.EdgeIndex);
    }

    [Fact]
    public void Calculator_NoPowerMachines_NoIssue()
    {
        var plan = new ProductionPlan { Nodes = [Furnace()] };

        Assert.True(Check(plan).IsValid);
    }

    [Fact]
    public void Simulator_EnoughPower_DrillRunsAtFullSpeed()
    {
        var sim = Simulate(Plan(generators: 1, drills: 1));
        sim.Run(30);

        var snapshot = sim.Snapshot();
        Near(200, snapshot.Power.SupplyKw, 1);
        Near(150, snapshot.Power.DemandKw, 1);
        Assert.Equal(1, snapshot.Power.Satisfaction);
        Near(12, snapshot.Nodes.Single(n => n.NodeId == "d").Outputs[0].ActualPerMinute);
    }

    [Fact]
    public void Simulator_Shortage_ScalesPoweredMachinesProportionally()
    {
        // 供給 200 kW、需求 300 kW → 供電比例 2/3
        var sim = Simulate(Plan(generators: 1, drills: 2));
        sim.Run(30);

        var snapshot = sim.Snapshot();
        Near(2.0 / 3, snapshot.Power.Satisfaction, 0.01);
        var drill = snapshot.Nodes.Single(n => n.NodeId == "d");
        Near(2.0 / 3, drill.Utilization, 0.01);
        Near(24 * 2.0 / 3, drill.Outputs[0].ActualPerMinute, 0.2);
        Assert.Equal(NodeStatus.Running, drill.Status);
    }

    [Fact]
    public void Simulator_GeneratorWithoutFuel_NoPower_DrillStops()
    {
        var sim = Simulate(Plan(generators: 1, drills: 1, fuelPerMinute: 0));
        sim.Run(10);

        var snapshot = sim.Snapshot();
        Assert.Equal(0, snapshot.Power.Satisfaction);
        var drill = snapshot.Nodes.Single(n => n.NodeId == "d");
        Assert.Equal(NodeStatus.Starved, drill.Status);
        Assert.Empty(drill.MissingInputs);
        Assert.True(drill.NoPower);
        Assert.Equal(0, drill.Outputs[0].ActualPerMinute);
    }

    [Fact]
    public void Simulator_NoPowerMachines_SatisfactionIsOne()
    {
        var sim = Simulate(new ProductionPlan { Nodes = [Furnace()], Sources = [Source("s", "alpha_ore", 30)], Edges = [Link("s", "f", "alpha_ore")] });
        sim.Run(5);

        var power = sim.Snapshot().Power;
        Assert.Equal(1, power.Satisfaction);
        Assert.Equal(0, power.DemandKw);
    }

    [Fact]
    public void BackgroundProduct_AppearsInBalance_AndCannotBeLinked()
    {
        var sim = Simulate(Plan(generators: 1, drills: 1));
        sim.Run(30);

        // 發電機全速燃燒 6 個 alpha_ore、產出 3 個 smog 的背景統計，沒有連線也不堵塞
        var smog = sim.Snapshot().Balances.Single(b => b.ProductId == "smog");
        Near(3, smog.SupplyPerMinute, 0.2);
        Assert.Equal(0, smog.DemandPerMinute);

        var plan = new ProductionPlan
        {
            Nodes = [Generator("g"), Furnace("f")],
            Edges = [Link("g", "f", "smog")],
        };
        var issue = Assert.Single(Check(plan).Issues, i => i.EdgeIndex == 0 && i.Message.Contains("背景統計值"));
        Assert.Contains("Smog", issue.Message);
    }

    [Fact]
    public void Calculator_RecipePowerMultiplier_ScalesPowerUse()
    {
        var fast = new Node { Id = "d", MachineId = "demo_drill", RecipeId = "mine_alpha_fast", Count = 2 };

        // 每台 150 kW × 配方倍率 4 × 2 台
        Assert.Equal(1200, Check(new ProductionPlan { Nodes = [fast] }).PowerUseKw);
        Assert.Equal(300, Check(new ProductionPlan { Nodes = [Drill("d", 2)] }).PowerUseKw);
    }

    [Fact]
    public void Simulator_PowerStarvedAndMissingMaterial_ReportsBoth()
    {
        // 鑽機沒有發電機：缺電；熔爐沒有電力需求，只缺料，不能被標成缺電
        var plan = new ProductionPlan { Nodes = [Drill("d"), Furnace("f")] };
        var sim = Simulate(plan);
        sim.Run(5);

        var nodes = sim.Snapshot().Nodes;
        Assert.True(nodes.Single(n => n.NodeId == "d").NoPower);
        var furnace = nodes.Single(n => n.NodeId == "f");
        Assert.False(furnace.NoPower);
        Assert.Equal(["alpha_ore"], furnace.MissingInputs);
    }

    [Fact]
    public void Simulator_PartialPower_IsNotMarkedNoPower()
    {
        var sim = Simulate(Plan(generators: 1, drills: 2));
        sim.Run(30);

        Assert.False(sim.Snapshot().Nodes.Single(n => n.NodeId == "d").NoPower);
    }
}
