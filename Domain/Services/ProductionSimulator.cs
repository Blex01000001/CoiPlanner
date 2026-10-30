using CoiPlanner.Domain.Models;

namespace CoiPlanner.Domain.Services;

/// <summary>
/// 以連續流量逐步模擬產線。每個節點獨立運作：
/// <list type="bullet">
/// <item>機器的每種輸入都有料，並等過啟動延遲後才生產；有輸入沒料（包含沒接線）就停擺，之後要重新等啟動延遲。</item>
/// <item>生產速度受最缺的輸入限制（減產），也受輸出暫存區剩餘空間限制（下游收不下時堵塞）。</item>
/// <item>沒接線的輸出視為直接送進倉庫，不會堵塞。</item>
/// <item>連線依建立順序填滿：每一步每條線最多運送「來源暫存量、運輸上限、目標剩餘空間」中最小的量，經過運送時間後送達。</item>
/// </list>
/// 節點與連線是否有效由 <see cref="PlanCalculator"/> 決定；有問題的節點與連線不參與模擬。
/// </summary>
public sealed class ProductionSimulator
{
    private const double Epsilon = 1e-9;

    private readonly SimulationSettings _settings;
    private readonly int _windowSteps;
    private Dictionary<string, SimNode> _nodes = new();
    private List<SimEdge> _edges = new();
    private ProductionPlan _plan = new();
    private PlanResult _check = new([], [], []);

    public ProductionSimulator(SimulationSettings? settings = null)
    {
        _settings = settings ?? new SimulationSettings();
        _windowSteps = Math.Max(1, (int)Math.Round(_settings.AverageSeconds / _settings.StepSeconds));
    }

    public SimulationSettings Settings => _settings;

    /// <summary>已經模擬的秒數。</summary>
    public double TimeSeconds { get; private set; }

    /// <summary>
    /// 套用修改後的產線，保留沿用節點的暫存量、啟動狀態與連線上運送中的物品。
    /// 節點以 id 加上機器／配方（或資源物品）辨識；連線以來源、目標、物品與同組內的順序辨識。
    /// </summary>
    public void Sync(ProductionPlan plan, PlanResult check)
    {
        _plan = plan;
        _check = check;
        var rated = check.Nodes.ToDictionary(n => n.NodeId);

        var nodes = new Dictionary<string, SimNode>();
        foreach (var n in plan.Nodes)
        {
            if (rated.TryGetValue(n.Id, out var r))
                nodes[n.Id] = Reuse(n.Id, $"m|{n.MachineId}|{n.RecipeId}", isSource: false, r);
        }
        foreach (var s in plan.Sources)
        {
            if (rated.TryGetValue(s.Id, out var r))
                nodes[s.Id] = Reuse(s.Id, $"s|{s.ProductId}", isSource: true, r);
        }

        var oldEdges = _edges.ToDictionary(e => e.Key);
        var edges = new List<SimEdge>();
        var ordinals = new Dictionary<(string, string, string), int>();
        for (var i = 0; i < plan.Edges.Count; i++)
        {
            var e = plan.Edges[i];
            if (check.EdgeCapacities.ElementAtOrDefault(i) is not { } capacity
                || !nodes.TryGetValue(e.SourceNodeId, out var from)
                || !nodes.TryGetValue(e.TargetNodeId, out var to)
                || from.Outputs.Find(s => s.ProductId == e.ProductId) is not { } fromSlot
                || to.Inputs.Find(s => s.ProductId == e.ProductId) is not { } toSlot)
                continue;

            var triple = (e.SourceNodeId, e.TargetNodeId, e.ProductId);
            var ordinal = ordinals[triple] = ordinals.GetValueOrDefault(triple) + 1;
            var key = $"{triple}|{ordinal}";
            var edge = new SimEdge(key, i, fromSlot, toSlot, capacity, _windowSteps);
            if (oldEdges.TryGetValue(key, out var old) && old.From.Owner == from && old.To.Owner == to)
                edge.InTransit.AddRange(old.InTransit);
            edges.Add(edge);
        }

        foreach (var slot in nodes.Values.SelectMany(n => n.Outputs))
            slot.Connected = edges.Any(e => e.From == slot);
        foreach (var slot in nodes.Values.SelectMany(n => n.Inputs))
            slot.Incoming = edges.Where(e => e.To == slot).Sum(e => e.InTransit.Sum(p => p.Amount));

        _nodes = nodes;
        _edges = edges;
    }

    /// <summary>清空所有暫存與運送中的物品，時間回到 0。</summary>
    public void Reset()
    {
        _nodes = new();
        _edges = new();
        TimeSeconds = 0;
        Sync(_plan, _check);
    }

    /// <summary>模擬指定的秒數（以步長為單位，不足一步的部分捨去）。</summary>
    public void Run(double seconds)
    {
        var steps = (int)Math.Round(seconds / _settings.StepSeconds);
        for (var i = 0; i < steps; i++)
            Step();
    }

    public void Step()
    {
        var dt = _settings.StepSeconds;
        Deliver();
        foreach (var node in _nodes.Values)
        {
            if (node.IsSource)
                ProduceSource(node, dt);
            else
                ProduceMachine(node, dt);
        }
        Transfer(dt);
        TimeSeconds += dt;
    }

    public SimulationSnapshot Snapshot()
    {
        var nodes = _nodes.Values.Select(n => new NodeState(
            n.Id,
            n.Status,
            n.Utilization.Average,
            Math.Max(0, n.StartupRemaining),
            n.Missing,
            n.Inputs.Select(SlotSnapshot).ToList(),
            n.Outputs.Select(SlotSnapshot).ToList())).ToList();

        var edges = _edges.Select(e => new EdgeState(e.Index, PerMinute(e.Meter), e.CapacityPerMinute)).ToList();

        var slots = _nodes.Values.SelectMany(n => n.Inputs.Concat(n.Outputs));
        var balances = slots.Select(s => s.ProductId).Distinct()
            .Order(StringComparer.Ordinal)
            .Select(id => new ProductBalance(
                id,
                _nodes.Values.SelectMany(n => n.Outputs).Where(s => s.ProductId == id).Sum(s => PerMinute(s.Meter)),
                _nodes.Values.SelectMany(n => n.Inputs).Where(s => s.ProductId == id).Sum(s => PerMinute(s.Meter))))
            .ToList();

        return new SimulationSnapshot(TimeSeconds, nodes, edges, balances);
    }

    private SlotState SlotSnapshot(SimSlot s) =>
        new(s.ProductId, PerMinute(s.Meter), s.RatedPerMinute, s.Stock, s.Capacity);

    private double PerMinute(RateMeter meter) => meter.Average / _settings.StepSeconds * 60;

    private SimNode Reuse(string id, string key, bool isSource, NodeResult rated)
    {
        if (!_nodes.TryGetValue(id, out var node) || node.Key != key)
            node = new SimNode(id, key, isSource, _settings.StartupSeconds, _windowSteps);

        node.Inputs = Slots(node, node.Inputs, rated.Inputs);
        node.Outputs = Slots(node, node.Outputs, rated.Outputs);
        return node;
    }

    /// <summary>依額定速率（機器數量可能改變）更新暫存容量，沿用原本的暫存量。</summary>
    private List<SimSlot> Slots(SimNode owner, List<SimSlot> old, IReadOnlyList<ProductRate> rates) =>
        rates.Select(r =>
        {
            var slot = old.Find(s => s.ProductId == r.ProductId) ?? new SimSlot(owner, r.ProductId, _windowSteps);
            slot.RatedPerMinute = r.PerMinute;
            slot.Capacity = r.PerMinute * _settings.BufferMinutes;
            slot.Stock = Math.Min(slot.Stock, slot.Capacity);
            return slot;
        }).ToList();

    private void Deliver()
    {
        foreach (var edge in _edges)
        {
            while (edge.InTransit.Count > 0 && edge.InTransit[0].ArriveAt <= TimeSeconds + Epsilon)
            {
                var amount = edge.InTransit[0].Amount;
                edge.InTransit.RemoveAt(0);
                edge.To.Incoming -= amount;
                edge.To.Stock = Math.Min(edge.To.Capacity, edge.To.Stock + amount);
            }
        }
    }

    private static void ProduceSource(SimNode node, double dt)
    {
        var output = node.Outputs[0];
        var target = output.RatedPerMinute * dt / 60;
        var produced = output.Connected ? Math.Min(target, output.Capacity - output.Stock) : target;
        produced = Math.Max(0, produced);
        if (output.Connected)
            output.Stock += produced;
        output.Meter.Add(produced);

        var f = target > 0 ? produced / target : 1;
        node.Status = target > 0 && produced <= Epsilon ? NodeStatus.Blocked : NodeStatus.Running;
        node.Missing = [];
        node.Utilization.Add(f);
    }

    private void ProduceMachine(SimNode node, double dt)
    {
        var f = 0.0;
        node.Missing = node.Inputs.Where(s => s.Stock <= Epsilon).Select(s => s.ProductId).ToList();
        if (node.Missing.Count > 0)
        {
            node.Status = NodeStatus.Starved;
            node.StartupRemaining = _settings.StartupSeconds;
        }
        else if (node.StartupRemaining > Epsilon)
        {
            node.Status = NodeStatus.Starting;
            node.StartupRemaining -= dt;
        }
        else
        {
            f = 1;
            foreach (var s in node.Inputs)
                f = Math.Min(f, s.Stock / (s.RatedPerMinute * dt / 60));
            foreach (var s in node.Outputs.Where(s => s.Connected))
                f = Math.Min(f, (s.Capacity - s.Stock) / (s.RatedPerMinute * dt / 60));
            f = Math.Max(0, f);

            if (f <= Epsilon)
            {
                // 輸入都有料卻做不了，只可能是輸出堵住；恢復時要重新等啟動延遲
                f = 0;
                node.Status = NodeStatus.Blocked;
                node.StartupRemaining = _settings.StartupSeconds;
            }
            else
            {
                node.Status = NodeStatus.Running;
            }
        }

        foreach (var s in node.Inputs)
        {
            var used = s.RatedPerMinute * dt / 60 * f;
            s.Stock = Math.Max(0, s.Stock - used);
            s.Meter.Add(used);
        }
        foreach (var s in node.Outputs)
        {
            var made = s.RatedPerMinute * dt / 60 * f;
            if (s.Connected)
                s.Stock = Math.Min(s.Capacity, s.Stock + made);
            s.Meter.Add(made);
        }
        node.Utilization.Add(f);
    }

    private void Transfer(double dt)
    {
        foreach (var edge in _edges)
        {
            var free = edge.To.Capacity - edge.To.Stock - edge.To.Incoming;
            var amount = Math.Max(0, Math.Min(edge.From.Stock, Math.Min(edge.CapacityPerMinute * dt / 60, free)));
            if (amount > Epsilon)
            {
                edge.From.Stock -= amount;
                edge.To.Incoming += amount;
                edge.InTransit.Add(new Packet(TimeSeconds + _settings.TransitSeconds, amount));
            }
            else
            {
                amount = 0;
            }
            edge.Meter.Add(amount);
        }
    }

    private sealed class SimNode(string id, string key, bool isSource, double startupSeconds, int windowSteps)
    {
        public string Id { get; } = id;
        public string Key { get; } = key;
        public bool IsSource { get; } = isSource;
        public List<SimSlot> Inputs { get; set; } = [];
        public List<SimSlot> Outputs { get; set; } = [];
        public NodeStatus Status { get; set; } = isSource ? NodeStatus.Running : NodeStatus.Starved;
        public double StartupRemaining { get; set; } = startupSeconds;
        public IReadOnlyList<string> Missing { get; set; } = [];
        public RateMeter Utilization { get; } = new(windowSteps);
    }

    private sealed class SimSlot(SimNode owner, string productId, int windowSteps)
    {
        public SimNode Owner { get; } = owner;
        public string ProductId { get; } = productId;
        public double RatedPerMinute { get; set; }
        public double Capacity { get; set; }
        public double Stock { get; set; }

        /// <summary>輸出：是否有接線（沒接線時送進倉庫，不佔暫存）。</summary>
        public bool Connected { get; set; }

        /// <summary>輸入：正在連線上、還沒送達的量；計算剩餘空間時要扣掉，避免送達時溢出。</summary>
        public double Incoming { get; set; }

        /// <summary>每一步實際消耗（輸入）或產出（輸出）的量。</summary>
        public RateMeter Meter { get; } = new(windowSteps);
    }

    private readonly record struct Packet(double ArriveAt, double Amount);

    private sealed class SimEdge(string key, int index, SimSlot from, SimSlot to, double capacityPerMinute, int windowSteps)
    {
        public string Key { get; } = key;
        public int Index { get; } = index;
        public SimSlot From { get; } = from;
        public SimSlot To { get; } = to;
        public double CapacityPerMinute { get; } = capacityPerMinute;
        public List<Packet> InTransit { get; } = [];
        public RateMeter Meter { get; } = new(windowSteps);
    }

    /// <summary>最近 N 步數值的移動平均。</summary>
    private sealed class RateMeter(int size)
    {
        private readonly double[] _values = new double[size];
        private int _next;
        private int _count;
        private double _sum;

        public double Average => _count == 0 ? 0 : _sum / _count;

        public void Add(double value)
        {
            _sum += value - _values[_next];
            _values[_next] = value;
            _next = (_next + 1) % _values.Length;
            _count = Math.Min(_count + 1, _values.Length);
        }
    }
}
