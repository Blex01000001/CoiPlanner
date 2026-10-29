using System.Text.Json;
using CoiPlanner.Domain.Models;

namespace CoiPlanner.Domain.Services;

/// <summary>載入並驗證 Data/*.json。</summary>
public sealed class GameDataLoader
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    public GameData LoadFromFile(string path)
    {
        using var stream = File.OpenRead(path);
        return Load(stream);
    }

    public GameData Load(Stream stream)
    {
        GameData? data;
        try
        {
            data = JsonSerializer.Deserialize<GameData>(stream, Options);
        }
        catch (JsonException ex)
        {
            throw new GameDataException($"JSON 格式錯誤：{ex.Message}", ex);
        }

        if (data is null)
            throw new GameDataException("JSON 內容為空。");

        Validate(data);
        return data;
    }

    public GameData Parse(string json)
    {
        using var stream = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(json));
        return Load(stream);
    }

    private static void Validate(GameData data)
    {
        var errors = new List<string>();

        var productIds = CollectIds(data.Products.Select(p => p.Id), "product", errors);
        var recipeIds = CollectIds(data.Recipes.Select(r => r.Id), "recipe", errors);
        CollectIds(data.Machines.Select(m => m.Id), "machine", errors);

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
