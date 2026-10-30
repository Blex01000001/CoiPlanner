using System.Text.Json;
using CoiPlanner.Domain.Models;

namespace CoiPlanner.Domain.Services;

/// <summary>載入並驗證 Data/*.json。</summary>
public sealed class GameDataLoader
{
    public GameData LoadFromFile(string path)
    {
        using var stream = File.OpenRead(path);
        return Load(stream);
    }

    public GameData Load(Stream stream)
    {
        var data = Deserialize(stream);
        Validate(data);
        return data;
    }

    /// <summary>讀取資料夾內所有 *.json，合併後一起驗證，跨檔案的重複 id 與引用也會被檢查。</summary>
    public GameData LoadFromDirectory(string directory)
    {
        if (!Directory.Exists(directory))
            throw new GameDataException($"找不到資料夾：{directory}");

        var files = Directory.GetFiles(directory, "*.json").Order(StringComparer.Ordinal).ToList();
        if (files.Count == 0)
            throw new GameDataException($"資料夾內沒有 *.json：{directory}");

        var parts = files.Select(file =>
        {
            try
            {
                using var stream = File.OpenRead(file);
                return Deserialize(stream);
            }
            catch (GameDataException ex)
            {
                throw new GameDataException($"{Path.GetFileName(file)}：{ex.Message}", ex);
            }
        }).ToList();

        var merged = new GameData
        {
            Products = parts.SelectMany(p => p.Products).ToList(),
            Recipes = parts.SelectMany(p => p.Recipes).ToList(),
            Machines = parts.SelectMany(p => p.Machines).ToList(),
            Transports = parts.SelectMany(p => p.Transports).ToList(),
        };
        Validate(merged);
        return merged;
    }

    public GameData Parse(string json)
    {
        using var stream = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(json));
        return Load(stream);
    }

    private static GameData Deserialize(Stream stream)
    {
        GameData? data;
        try
        {
            data = JsonSerializer.Deserialize<GameData>(stream, JsonDefaults.Options);
        }
        catch (JsonException ex)
        {
            throw new GameDataException($"JSON 格式錯誤：{ex.Message}", ex);
        }

        return data ?? throw new GameDataException("JSON 內容為空。");
    }

    private static void Validate(GameData data)
    {
        var errors = new List<string>();

        var productIds = CollectIds(data.Products.Select(p => p.Id), "product", errors);
        var recipeIds = CollectIds(data.Recipes.Select(r => r.Id), "recipe", errors);
        CollectIds(data.Machines.Select(m => m.Id), "machine", errors);
        CollectIds(data.Transports.Select(t => t.Id), "transport", errors);

        var kinds = new HashSet<string>();
        foreach (var transport in data.Transports)
        {
            if (!kinds.Add(transport.Kind))
                errors.Add($"transport '{transport.Id}'：物品型態 '{transport.Kind}' 已經有其他運輸方式，一種型態只能走一種運輸。");
            if (transport.TiersPerMinute.Count == 0)
                errors.Add($"transport '{transport.Id}' 沒有任何等級（tiersPerMinute）。");
            if (transport.TiersPerMinute.Any(t => t <= 0))
                errors.Add($"transport '{transport.Id}' 的每個等級吞吐量都必須大於 0。");
        }

        foreach (var product in data.Products.Where(p => p.Kind is not null && !kinds.Contains(p.Kind)))
            errors.Add($"product '{product.Id}' 的型態 '{product.Kind}' 沒有對應的運輸方式。");

        foreach (var recipe in data.Recipes)
        {
            if (recipe.CycleSeconds <= 0)
                errors.Add($"recipe '{recipe.Id}' 的 cycleSeconds 必須大於 0。");

            foreach (var item in recipe.Inputs.Concat(recipe.Outputs))
            {
                if (!productIds.Contains(item.ProductId))
                    errors.Add($"recipe '{recipe.Id}' 引用了不存在的 product '{item.ProductId}'。");
                if (item.Quantity <= 0)
                    errors.Add($"recipe '{recipe.Id}' 中 '{item.ProductId}' 的 quantity 必須大於 0。");
            }
        }

        foreach (var machine in data.Machines)
        {
            foreach (var recipeId in machine.RecipeIds.Where(id => !recipeIds.Contains(id)))
                errors.Add($"machine '{machine.Id}' 引用了不存在的 recipe '{recipeId}'。");
        }

        if (errors.Count > 0)
            throw new GameDataException(string.Join(Environment.NewLine, errors));
    }

    private static HashSet<string> CollectIds(IEnumerable<string> ids, string kind, List<string> errors)
    {
        var set = new HashSet<string>();
        foreach (var id in ids)
        {
            if (!set.Add(id))
                errors.Add($"{kind} id '{id}' 重複。");
        }
        return set;
    }
}
