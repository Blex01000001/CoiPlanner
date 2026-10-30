using CoiPlanner.Domain.Models;
using CoiPlanner.Domain.Services;
using static CoiPlanner.Domain.Tests.TestData;

namespace CoiPlanner.Domain.Tests;

/// <summary>
/// 熔爐：alpha_ore 12/分 → beta_ingot 6/分；壓床：beta_ingot 9/分 → gamma_plate 6/分。
/// 輸送帶一級 10/分、二級 100/分。模擬參數用預設值：步長 0.1 秒、暫存 1 分鐘、運送 0.5 秒、啟動 0.5 秒、平均 5 秒。
/// </summary>
public class ProductionSimulatorTests
{
    private static ProductionSimulator Simulate(Node[] nodes, ResourceSource[] sources, params Edge[] edges) =>
        Simulate(new ProductionPlan { Nodes = nodes, Sources = sources, Edges = edges });

    private static ProductionSimulator Simulate(ProductionPlan plan)
    {
        var sim = new ProductionSimulator();
        sim.Sync(plan, new PlanCalculator(Sample).Calculate(plan));
        return sim;
    }

    private static NodeState Node(ProductionSimulator sim, string id) => sim.Snapshot().Nodes.Single(n => n.NodeId == id);

    private static void Near(double expected, double actual, double tolerance = 0.05) =>
        Assert.InRange(actual, expected - tolerance, expected + tolerance);

    [Fact]
    public void Machine_WaitsForDeliveryThenStartupDelay()
    {
        var sim = Simulate([Furnace("f")], [Source("s", "alpha_ore", 30)], Link("s", "f", "alpha_ore"));

        // 0.5 秒運送期間沒有料
        sim.Run(0.5);
        Assert.Equal(NodeStatus.Starved, Node(sim, "f").Status);

        // 料在 0.5 秒送達，之後等 0.5 秒才開始生產（1.0 秒那一步開始）
        sim.Run(0.4);
        var starting = Node(sim, "f");
        Assert.Equal(NodeStatus.Starting, starting.Status);
        Assert.Equal(0, starting.Outputs[0].ActualPerMinute);

        sim.Run(0.2);
        Assert.Equal(NodeStatus.Running, Node(sim, "f").Status);
    }

    [Fact]
    public void Transit_DeliversAfterHalfSecond()
    {
        var sim = Simulate([Furnace("f")], [Source("s", "alpha_ore", 30)], Link("s", "f", "alpha_ore"));

        sim.Run(0.5);
        Assert.Equal(0, Node(sim, "f").Inputs[0].Stock);
        sim.Step();
        Assert.True(Node(sim, "f").Inputs[0].Stock > 0);
    }

    [Fact]
    public void FullSupply_RunsAtRatedSpeed()
    {
        var sim = Simulate([Furnace("f")], [Source("s", "alpha_ore", 30)], Link("s", "f", "alpha_ore"));

        // 一開始來源送 30/分、熔爐只用 12/分，熔爐的輸入暫存（12）大約 40 秒後才滿，之後連線只跟著消耗運送
        sim.Run(300);

        var f = Node(sim, "f");
        Assert.Equal(NodeStatus.Running, f.Status);
        Near(1, f.Utilization, 0.001);
        Near(6, f.Outputs[0].ActualPerMinute);
        Near(12, Assert.Single(sim.Snapshot().Edges).FlowPerMinute);
    }

    [Fact]
    public void UnconnectedInput_Starves()
    {
        var sim = Simulate([Furnace("f")], []);

        sim.Run(10);

        var f = Node(sim, "f");
        Assert.Equal(NodeStatus.Starved, f.Status);
        Assert.Equal(["alpha_ore"], f.MissingInputs);
        Assert.Equal(0, f.Utilization);
    }

    [Fact]
    public void PartialSupply_ReducesOutput()
    {
        var sim = Simulate([Furnace("f")], [Source("s", "alpha_ore", 6)], Link("s", "f", "alpha_ore"));

        sim.Run(120);

        var f = Node(sim, "f");
        Assert.Equal(NodeStatus.Running, f.Status);
        Near(0.5, f.Utilization, 0.01);
        Near(3, f.Outputs[0].ActualPerMinute);
    }

    [Fact]
    public void TransportCapacity_LimitsFlow()
    {
        var sim = Simulate([Furnace("f")], [Source("s", "alpha_ore", 30)], Link("s", "f", "alpha_ore", tier: 1));

        sim.Run(120);

        var edge = Assert.Single(sim.Snapshot().Edges);
        Near(10, edge.FlowPerMinute);
        Assert.True(edge.IsFull);
        Near(10.0 / 12, Node(sim, "f").Utilization, 0.01);
    }

    [Fact]
    public void DownstreamFull_BacksUpAndFillsInOrder()
    {
        // 兩台熔爐共產 12 beta/分，壓床只吃 9：壓床暫存滿了以後，第一條線優先，第二台熔爐只能做一半
        var sim = Simulate(
            [Furnace("f1"), Furnace("f2"), Press("p")],
            [Source("a", "alpha_ore", 30), Source("b", "alpha_ore", 30)],
            Link("a", "f1", "alpha_ore"),
            Link("b", "f2", "alpha_ore"),
            Link("f1", "p", "beta_ingot"),
            Link("f2", "p", "beta_ingot"));

        sim.Run(30 * 60);

        Near(1, Node(sim, "p").Utilization, 0.01);
        Near(1, Node(sim, "f1").Utilization, 0.01);
        Near(0.5, Node(sim, "f2").Utilization, 0.02);
        var beta = sim.Snapshot().Balances.Single(b => b.ProductId == "beta_ingot");
        Near(9, beta.SupplyPerMinute, 0.1);
        Near(9, beta.DemandPerMinute, 0.1);
    }

    [Fact]
    public void FillInOrder_SecondLinkGetsSurplusAfterFirstBufferFills()
    {
        // 來源 30/分先送給第一台熔爐（用 12/分）：它的 1 分鐘暫存（12）每分鐘多 18，約 40 秒才滿；
        // 在那之前第二台熔爐分不到料，之後才拿到剩下的 18/分
        var sim = Simulate(
            [Furnace("f1"), Furnace("f2")],
            [Source("s", "alpha_ore", 30)],
            Link("s", "f1", "alpha_ore"),
            Link("s", "f2", "alpha_ore"));

        sim.Run(35);
        Assert.Equal(NodeStatus.Starved, Node(sim, "f2").Status);

        sim.Run(60);
        Assert.Equal(NodeStatus.Running, Node(sim, "f2").Status);
        Near(1, Node(sim, "f2").Utilization, 0.01);
    }

    [Fact]
    public void Source_BlocksWhenItsBufferIsFull()
    {
        // 來源 30/分只被拿走 12/分，1 分鐘的暫存（30）滿了以後只能跟著需求生產
        var sim = Simulate([Furnace("f")], [Source("s", "alpha_ore", 30)], Link("s", "f", "alpha_ore"));

        sim.Run(10 * 60);

        var s = Node(sim, "s");
        Near(12, s.Outputs[0].ActualPerMinute, 0.1);
        Near(30, s.Outputs[0].Stock, 0.5);
    }

    [Fact]
    public void UnconnectedOutput_GoesToWarehouseAndNeverBlocks()
    {
        var sim = Simulate([Furnace("f")], [Source("s", "alpha_ore", 30)], Link("s", "f", "alpha_ore"));

        sim.Run(10 * 60);

        var f = Node(sim, "f");
        Assert.Equal(NodeStatus.Running, f.Status);
        Near(6, f.Outputs[0].ActualPerMinute);
        Assert.Equal(0, f.Outputs[0].Stock);
    }

    [Fact]
    public void Balances_UseActualRates()
    {
        // 熔爐 6 beta/分 供給需要 9 的壓床：壓床減產，beta 實際產出 = 消耗 = 6
        var sim = Simulate(
            [Furnace("f"), Press("p")],
            [Source("s", "alpha_ore", 12)],
            Link("s", "f", "alpha_ore"),
            Link("f", "p", "beta_ingot"));

        sim.Run(300);

        var beta = sim.Snapshot().Balances.Single(b => b.ProductId == "beta_ingot");
        Near(6, beta.SupplyPerMinute);
        Near(6, beta.DemandPerMinute);
        Near(6.0 / 9, Node(sim, "p").Utilization, 0.01);
    }

    [Fact]
    public void Sync_KeepsStateOfUnchangedNodes()
    {
        var plan = new ProductionPlan
        {
            Nodes = [Furnace("f")],
            Sources = [Source("s", "alpha_ore", 30)],
            Edges = [Link("s", "f", "alpha_ore")],
        };
        var sim = Simulate(plan);
        sim.Run(60);
        var before = Node(sim, "s").Outputs[0].Stock;

        var edited = plan with { Nodes = [Furnace("f", count: 2)] };
        sim.Sync(edited, new PlanCalculator(Sample).Calculate(edited));

        Assert.Equal(60, sim.TimeSeconds, 6);
        Assert.Equal(before, Node(sim, "s").Outputs[0].Stock);
        var f = Node(sim, "f");
        Assert.Equal(NodeStatus.Running, f.Status);
        Assert.Equal(24, f.Inputs[0].Capacity);
    }

    [Fact]
    public void Sync_ReplacedNodeStartsEmpty()
    {
        var plan = new ProductionPlan { Nodes = [Furnace("x")], Sources = [Source("s", "alpha_ore", 30)], Edges = [Link("s", "x", "alpha_ore")] };
        var sim = Simulate(plan);
        sim.Run(60);

        // 同一個 id 換成別的機器，狀態不能沿用
        var edited = plan with { Nodes = [Press("x")], Edges = [] };
        sim.Sync(edited, new PlanCalculator(Sample).Calculate(edited));

        var x = Node(sim, "x");
        Assert.Equal("beta_ingot", Assert.Single(x.Inputs).ProductId);
        Assert.Equal(0, x.Inputs[0].Stock);
    }

    [Fact]
    public void Reset_ClearsTimeAndStock()
    {
        var sim = Simulate([Furnace("f")], [Source("s", "alpha_ore", 30)], Link("s", "f", "alpha_ore"));
        sim.Run(60);

        sim.Reset();

        Assert.Equal(0, sim.TimeSeconds);
        Assert.All(sim.Snapshot().Nodes.SelectMany(n => n.Inputs.Concat(n.Outputs)), s => Assert.Equal(0, s.Stock));
        Assert.Equal(NodeStatus.Starved, Node(sim, "f").Status);
    }

    [Fact]
    public void InvalidNodesAndEdges_AreSkipped()
    {
        var bad = new Node { Id = "bad", MachineId = "missing", RecipeId = "smelt_beta", Count = 1 };
        var sim = Simulate([bad, Furnace("f")], [Source("s", "alpha_ore", 30)],
            Link("s", "f", "alpha_ore", transport: "pipe", tier: 1));

        sim.Run(10);

        var snapshot = sim.Snapshot();
        Assert.DoesNotContain(snapshot.Nodes, n => n.NodeId == "bad");
        Assert.Empty(snapshot.Edges);
        Assert.Equal(NodeStatus.Starved, Node(sim, "f").Status);
    }
}
