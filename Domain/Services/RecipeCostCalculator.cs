using CoiPlanner.Domain.Models;

namespace CoiPlanner.Domain.Services;

/// <summary>
/// 比較生產某個物品的各種配方：把輸入一路展開到原料，算出每 1 單位目標物品需要多少原料（加權成本）、
/// 會多出哪些副產品，以及維持 1 單位/分需要的耗電、工人、維修。
/// <list type="bullet">
/// <item>原料＝有「沒有輸入的配方」（抽水、採礦…）產出的物品，或完全沒有配方產出的物品（資料缺少，視為外部輸入，見 <see cref="IsExternal"/>）。</item>
/// <item>中間物品有多種做法時，取加權成本最低的配方（循環時以反覆逼近求解）。只有目標物品本身會列出所有配方。</item>
/// <item>副產品不分攤成本、不抵扣，只單獨列出數量。</item>
/// <item>展開時若上游又需要目標物品本身（循環），那一部分視為外部輸入，以該物品目前最低的生產成本計價，並附上警告。</item>
/// <item>機器依「機器＋配方」分開列（同一種機器跑不同配方不合併）；耗電、工人、維修包含採集原料的機器（例如海水泵）；原料有多種採集配方時取每單位耗電最低的。</item>
/// </list>
/// </summary>
public sealed class RecipeCostCalculator
{
    private const int MaxIterations = 200;
    private const double Epsilon = 1e-12;

    private readonly GameData _data;
    private readonly Dictionary<string, Product> _products;
    private readonly Dictionary<string, List<Recipe>> _producers = new();
    private readonly Dictionary<string, Machine> _machineByRecipe = new();

    public RecipeCostCalculator(GameData data)
    {
        _data = data;
        _products = data.Products.ToDictionary(p => p.Id);
        foreach (var recipe in data.Recipes)
        {
            foreach (var output in recipe.Outputs.Where(o => o.Quantity > 0))
            {
                if (!_producers.TryGetValue(output.ProductId, out var list))
                    _producers[output.ProductId] = list = [];
                if (!list.Contains(recipe))
                    list.Add(recipe);
            }
        }
        foreach (var machine in data.Machines)
        {
            foreach (var recipeId in machine.RecipeIds)
                _machineByRecipe.TryAdd(recipeId, machine);
        }
    }

    /// <summary>沒有任何配方產出：資料缺少，視為外部輸入。</summary>
    public bool IsExternal(string productId) => !_producers.ContainsKey(productId);

    /// <summary>原料：外部輸入，或有「沒有輸入的配方」產出。</summary>
    public bool IsRaw(string productId) =>
        !_producers.TryGetValue(productId, out var list) || list.Any(r => r.Inputs.Count == 0);

    /// <summary>所有原料（背景統計值除外），依資料中物品的順序；用來讓使用者設定權重。</summary>
    public IReadOnlyList<string> RawProductIds =>
        _data.Products.Where(p => !p.Background && IsRaw(p.Id)).Select(p => p.Id).ToList();

    /// <summary>可以選來比較的物品：有配方產出的，以及外部輸入（會顯示「沒有配方」）；背景統計值除外。</summary>
    public IReadOnlyList<string> TargetProductIds => _data.Products.Where(p => !p.Background).Select(p => p.Id).ToList();

    /// <summary>
    /// 比較生產 <paramref name="productId"/> 的各種配方。weights 是每種原料的權重（沒列出的視為 1，不能是負數）。
    /// </summary>
    public CostReport Calculate(string productId, IReadOnlyDictionary<string, double>? weights = null)
    {
        if (!_producers.TryGetValue(productId, out var recipes))
            return new CostReport(productId, []);

        var weightOf = (string id) => weights is not null && weights.TryGetValue(id, out var w) ? Math.Max(0, w) : 1.0;
        var (best, cost) = BestRecipes(weightOf);
        // 原料用權重計價；循環時視為外部輸入的中間物品，用它目前最低的生產成本計價（算不出來時才用權重）
        double UnitCost(string id) => !IsRaw(id) && cost.TryGetValue(id, out var c) && double.IsFinite(c) ? c : weightOf(id);
        var routes = recipes.Select(r => Expand(productId, r, best, UnitCost))
            .OrderBy(r => r.WeightedCost).ThenBy(r => r.PowerKw)
            .ToList();
        return new CostReport(productId, routes);
    }

    /// <summary>每個非原料物品加權成本最低的配方。成本以反覆逼近求解，所以配方之間有循環也能算。</summary>
    private (Dictionary<string, Recipe> Best, Dictionary<string, double> Cost) BestRecipes(Func<string, double> weightOf)
    {
        var cost = new Dictionary<string, double>();
        foreach (var id in _products.Keys)
            cost[id] = IsRaw(id) ? weightOf(id) : double.PositiveInfinity;

        var best = new Dictionary<string, Recipe>();
        for (var i = 0; i < MaxIterations; i++)
        {
            var changed = false;
            foreach (var (productId, recipes) in _producers)
            {
                if (IsRaw(productId))
                    continue;
                foreach (var recipe in recipes)
                {
                    var perUnit = recipe.OutputPerMinute(productId);
                    var total = recipe.Inputs.Sum(input => recipe.InputPerMinute(input.ProductId) * cost.GetValueOrDefault(input.ProductId, double.PositiveInfinity));
                    var candidate = total / perUnit;
                    if (double.IsFinite(candidate) && candidate < cost[productId] - Epsilon)
                    {
                        cost[productId] = candidate;
                        best[productId] = recipe;
                        changed = true;
                    }
                }
            }
            if (!changed)
                break;
        }
        return (best, cost);
    }

    private RouteCost Expand(string target, Recipe recipe, Dictionary<string, Recipe> best, Func<string, double> unitCost)
    {
        var acc = new Accumulator();
        var path = new HashSet<string> { target };
        Run(acc, recipe, target, 1, best, path, countRawOutput: true);

        var raw = acc.Raw.Select(kv => new ProductAmount(kv.Key, kv.Value)).ToList();
        return new RouteCost(
            recipe.Id,
            raw,
            acc.Byproducts.Select(kv => new ProductAmount(kv.Key, kv.Value)).ToList(),
            raw.Sum(r => r.Quantity * unitCost(r.ProductId)),
            acc.Machines.Select(kv => new MachineNeed(kv.Key.MachineId, kv.Key.RecipeId, kv.Value)).ToList(),
            acc.PowerKw,
            acc.Workers,
            acc.Maintenance.Select(kv => new MaintenanceNeed(kv.Key, kv.Value)).ToList(),
            acc.Steps,
            acc.Warnings.ToList());
    }

    /// <summary>用 recipe 生產 quantityPerMinute 的 productId：累計機器、耗電、副產品，再往下展開輸入。</summary>
    private void Run(Accumulator acc, Recipe recipe, string productId, double quantityPerMinute, Dictionary<string, Recipe> best, HashSet<string> path, bool countRawOutput = false)
    {
        // 一台機器每分鐘產出 OutputPerMinute，所以需要的機器台數（可能是小數）
        var machines = quantityPerMinute / recipe.OutputPerMinute(productId);
        if (_machineByRecipe.TryGetValue(recipe.Id, out var machine))
        {
            var key = (machine.Id, recipe.Id);
            acc.Machines[key] = acc.Machines.GetValueOrDefault(key) + machines;
            acc.PowerKw += machines * machine.PowerUseKw * recipe.PowerMultiplier;
            acc.Workers += machines * machine.Workers;
            if (machine.MaintenancePerMinute > 0 && !string.IsNullOrWhiteSpace(machine.MaintenanceType))
                acc.Maintenance[machine.MaintenanceType] = acc.Maintenance.GetValueOrDefault(machine.MaintenanceType) + machines * machine.MaintenancePerMinute;
        }

        foreach (var output in recipe.Outputs.Where(o => o.ProductId != productId))
            acc.Byproducts[output.ProductId] = acc.Byproducts.GetValueOrDefault(output.ProductId) + machines * recipe.OutputPerMinute(output.ProductId);

        // 沒有輸入的配方（採集）直接當目標時，產出的就是原料本身；展開輸入時遇到的原料已經在 Need 計過了
        if (recipe.Inputs.Count == 0 && countRawOutput)
            acc.Raw[productId] = acc.Raw.GetValueOrDefault(productId) + quantityPerMinute;

        foreach (var input in recipe.Inputs)
            Need(acc, input.ProductId, machines * recipe.InputPerMinute(input.ProductId), best, path);
    }

    private void Need(Accumulator acc, string productId, double quantityPerMinute, Dictionary<string, Recipe> best, HashSet<string> path)
    {
        if (IsRaw(productId))
        {
            acc.Raw[productId] = acc.Raw.GetValueOrDefault(productId) + quantityPerMinute;
            // 採集原料的機器也要算（耗電、工人、維修）；有多種採集配方時用每單位耗電最低的（同樣時取資料中先出現的）
            if (_producers.TryGetValue(productId, out var recipes)
                && recipes.Where(r => r.Inputs.Count == 0).OrderBy(r => PowerPerUnit(r, productId)).FirstOrDefault() is { } extraction)
                Run(acc, extraction, productId, quantityPerMinute, best, [.. path, productId], countRawOutput: false);
            return;
        }

        if (path.Contains(productId))
        {
            acc.Raw[productId] = acc.Raw.GetValueOrDefault(productId) + quantityPerMinute;
            acc.Warnings.Add($"循環：{ProductName(productId)} 的上游又需要它，視為外部輸入。");
            return;
        }

        if (!best.TryGetValue(productId, out var recipe))
        {
            acc.Raw[productId] = acc.Raw.GetValueOrDefault(productId) + quantityPerMinute;
            acc.Warnings.Add($"{ProductName(productId)} 沒有可行的做法，視為外部輸入。");
            return;
        }

        if (!acc.Steps.Any(s => s.ProductId == productId))
            acc.Steps.Add(new UpstreamStep(productId, recipe.Id));
        path.Add(productId);
        Run(acc, recipe, productId, quantityPerMinute, best, path);
        path.Remove(productId);
    }

    private double PowerPerUnit(Recipe recipe, string productId) =>
        _machineByRecipe.TryGetValue(recipe.Id, out var machine)
            ? machine.PowerUseKw * recipe.PowerMultiplier / recipe.OutputPerMinute(productId)
            : 0;

    private string ProductName(string id) => _products.TryGetValue(id, out var p) ? p.Name : id;

    private sealed class Accumulator
    {
        public Dictionary<string, double> Raw { get; } = new();
        public Dictionary<string, double> Byproducts { get; } = new();
        public Dictionary<(string MachineId, string RecipeId), double> Machines { get; } = new();
        public Dictionary<string, double> Maintenance { get; } = new();
        public List<UpstreamStep> Steps { get; } = [];
        public HashSet<string> Warnings { get; } = [];
        public double PowerKw { get; set; }
        public double Workers { get; set; }
    }
}
