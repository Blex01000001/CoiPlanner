using System.Text.Json;
using Microsoft.JSInterop;

namespace CoiPlanner.Services;

/// <summary>瀏覽器 localStorage 用到的鍵名，集中在這裡，避免散落各頁面。這些資料只存在使用者自己的瀏覽器裡。</summary>
public static class StorageKeys
{
    /// <summary>產線規劃的自動存檔（ProductionPlan 的 JSON）。</summary>
    public const string Plan = "coiplanner.plan";

    /// <summary>配方成本頁：原料權重（物品 id → 權重）。</summary>
    public const string CostWeights = "coiplanner.costWeights";

    /// <summary>配方成本頁：指定的中間物品做法（物品 id → 配方 id）。</summary>
    public const string CostRecipes = "coiplanner.costRecipes";

    /// <summary>配方成本頁：上次選擇的目標物品 id。</summary>
    public const string CostProduct = "coiplanner.costProduct";
}

/// <summary>
/// 讀寫瀏覽器的 localStorage。讀 JSON 時內容壞掉或不存在一律回傳預設值，不丟例外：
/// 這些都是使用者的偏好或自動存檔，壞掉時用預設值繼續就好（規劃檔另有自己的讀取與提示，見 Planner）。
/// </summary>
public sealed class BrowserStorage(IJSRuntime js)
{
    public ValueTask<string?> GetStringAsync(string key) => js.InvokeAsync<string?>("localStorage.getItem", key);

    public ValueTask SetStringAsync(string key, string value) => js.InvokeVoidAsync("localStorage.setItem", key, value);

    public ValueTask RemoveAsync(string key) => js.InvokeVoidAsync("localStorage.removeItem", key);

    /// <summary>讀出 JSON 並轉成 T；沒有資料或內容壞掉時回傳 fallback。</summary>
    public async Task<T> GetJsonAsync<T>(string key, T fallback)
    {
        var json = await GetStringAsync(key);
        if (string.IsNullOrEmpty(json))
            return fallback;
        try
        {
            return JsonSerializer.Deserialize<T>(json) ?? fallback;
        }
        catch (JsonException)
        {
            return fallback;
        }
    }

    public ValueTask SetJsonAsync<T>(string key, T value) => SetStringAsync(key, JsonSerializer.Serialize(value));
}
