using CoiPlanner.Domain.Models;

namespace CoiPlanner.Domain.Services;

/// <summary>依 <see cref="GameData"/> 計算產線規劃的速率與物料平衡，並找出規劃中的錯誤。</summary>
public sealed class PlanCalculator
{
    private readonly Dictionary<string, Product> _products;
    private readonly Dictionary<string, Recipe> _recipes;
    private readonly Dictionary<string, Machine> _machines;

    public PlanCalculator(GameData data)
    {
        _products = data.Products.ToDictionary(p => p.Id);
        _recipes = data.Recipes.ToDictionary(r => r.Id);
        _machines = data.Machines.ToDictionary(m => m.Id);
    }

    public PlanResult Calculate(ProductionPlan plan)
    {
        var issues = new List<PlanIssue>();
        var nodeResults = new List<NodeResult>();
        // 只有通過檢查的節點會記錄配方，供連線檢查與速率計算使用
        var nodeRecipes = new Dictionary<string, Recipe>();
        var nodeIds = new HashSet<string>();

        foreach (var node in plan.Nodes)
        {
            if (!nodeIds.Add(node.Id))
            {
                issues.Add(new($"節點 id '{node.Id}' 重複。", node.Id));
                continue;
            }

            var recipe = CheckNode(node, issues);
            if (recipe is null)
                continue;

            nodeRecipes[node.Id] = recipe;
            nodeResults.Add(new NodeResult(
                node.Id,
                recipe.Inputs.Select(i => new ProductRate(i.ProductId, recipe.InputPerMinute(i.ProductId) * node.Count)).ToList(),
                recipe.Outputs.Select(o => new ProductRate(o.ProductId, recipe.OutputPerMinute(o.ProductId) * node.Count)).ToList()));
        }

        for (var i = 0; i < plan.Edges.Count; i++)
            CheckEdge(plan.Edges[i], i, nodeIds, nodeRecipes, issues);

        return new PlanResult(nodeResults, Balance(nodeResults), issues);
    }

    private Recipe? CheckNode(Node node, List<PlanIssue> issues)
    {
        var ok = true;
        if (node.Count <= 0)
        {
            issues.Add(new($"節點 '{node.Id}' 的機器數量必須大於 0。", node.Id));
            ok = false;
        }
        if (!_machines.TryGetValue(node.MachineId, out var machine))
        {
            issues.Add(new($"節點 '{node.Id}' 的機器 '{node.MachineId}' 不存在。", node.Id));
            ok = false;
        }
        if (!_recipes.TryGetValue(node.RecipeId, out var recipe))
        {
            issues.Add(new($"節點 '{node.Id}' 的配方 '{node.RecipeId}' 不存在。", node.Id));
            ok = false;
        }
        if (machine is not null && recipe is not null && !machine.CanRun(recipe.Id))
        {
            issues.Add(new($"機器 '{machine.Name}' 不能執行配方 '{recipe.Name}'。", node.Id));
            ok = false;
        }
        return ok ? recipe : null;
    }

    private void CheckEdge(Edge edge, int index, HashSet<string> nodeIds,
        Dictionary<string, Recipe> nodeRecipes, List<PlanIssue> issues)
    {
        if (!_products.ContainsKey(edge.ProductId))
            issues.Add(new($"連線 #{index} 的物品 '{edge.ProductId}' 不存在。", EdgeIndex: index));
        if (edge.SourceNodeId == edge.TargetNodeId)
            issues.Add(new($"連線 #{index} 的來源與目標是同一個節點。", EdgeIndex: index));

        if (!nodeIds.Contains(edge.SourceNodeId))
            issues.Add(new($"連線 #{index} 的來源節點 '{edge.SourceNodeId}' 不存在。", EdgeIndex: index));
        else if (nodeRecipes.TryGetValue(edge.SourceNodeId, out var source) && source.OutputPerMinute(edge.ProductId) == 0)
            issues.Add(new($"連線 #{index}：來源節點 '{edge.SourceNodeId}' 不產出 '{edge.ProductId}'。", EdgeIndex: index));

        if (!nodeIds.Contains(edge.TargetNodeId))
            issues.Add(new($"連線 #{index} 的目標節點 '{edge.TargetNodeId}' 不存在。", EdgeIndex: index));
        else if (nodeRecipes.TryGetValue(edge.TargetNodeId, out var target) && target.InputPerMinute(edge.ProductId) == 0)
            issues.Add(new($"連線 #{index}：目標節點 '{edge.TargetNodeId}' 不使用 '{edge.ProductId}'。", EdgeIndex: index));
    }

    private static List<ProductBalance> Balance(IEnumerable<NodeResult> nodes)
    {
        var supply = new Dictionary<string, double>();
        var demand = new Dictionary<string, double>();
        foreach (var node in nodes)
        {
            foreach (var o in node.Outputs)
                supply[o.ProductId] = supply.GetValueOrDefault(o.ProductId) + o.PerMinute;
            foreach (var i in node.Inputs)
                demand[i.ProductId] = demand.GetValueOrDefault(i.ProductId) + i.PerMinute;
        }

        return supply.Keys.Union(demand.Keys)
            .Order(StringComparer.Ordinal)
            .Select(id => new ProductBalance(id, supply.GetValueOrDefault(id), demand.GetValueOrDefault(id)))
            .ToList();
    }
}
