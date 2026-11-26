using System.Text.RegularExpressions;
using CoiPlanner.Domain.Models;
using CoiPlanner.Domain.Services;

namespace CoiPlanner.Domain.Tests;

/// <summary>檢查專案根目錄的 NAMES.md（名稱對照表）和實際的 Data/*.json 一致，並強制名稱的寫法規則。</summary>
public class NameMapTests
{
    private static readonly string[] Lines = File.ReadAllLines(FindFile("NAMES.md"));
    private static readonly GameData Data = new GameDataLoader().LoadFromDirectory(Path.Combine(AppContext.BaseDirectory, "Data"));

    private static string FindFile(string name)
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, name);
            if (File.Exists(candidate))
                return candidate;
        }
        throw new FileNotFoundException($"找不到 {name}");
    }

    /// <summary>某一節（標題以 prefix 開頭）的表格資料列，每列是去掉前後空白的儲存格；略過表頭與分隔線。</summary>
    private static List<string[]> Rows(string sectionPrefix)
    {
        var rows = new List<string[]>();
        var inSection = false;
        var headerSeen = false;
        foreach (var line in Lines)
        {
            if (line.StartsWith("## "))
            {
                inSection = line.StartsWith(sectionPrefix);
                headerSeen = false;
                continue;
            }
            if (!inSection || !line.StartsWith('|'))
                continue;
            var cells = line.Trim().Trim('|').Split('|').Select(c => c.Trim()).ToArray();
            if (cells.All(c => Regex.IsMatch(c, "^:?-+:?$")))
                continue;
            if (!headerSeen)
            {
                headerSeen = true;
                continue;
            }
            rows.Add(cells);
        }
        return rows;
    }

    private static string? NameOf(string type, string id) => type switch
    {
        "物品" => Data.Products.FirstOrDefault(p => p.Id == id)?.Name,
        "機器" => Data.Machines.FirstOrDefault(m => m.Id == id)?.Name,
        _ => null,
    };

    [Fact]
    public void Aliases_PointToExistingItemsWithTheirCurrentName()
    {
        var rows = Rows("## 1.");
        Assert.NotEmpty(rows);

        foreach (var row in rows)
        {
            var (alias, canonical, id, type, status) = (row[0], row[1], row[2], row[3], row[4]);
            Assert.True(type is "物品" or "機器", $"別名「{alias}」的類型必須是「物品」或「機器」：{type}");
            Assert.True(status is "已確認" or "待確認", $"別名「{alias}」的狀態必須是「已確認」或「待確認」：{status}");
            Assert.True(NameOf(type, id) is not null, $"別名「{alias}」的 id「{id}」不存在");
            Assert.Equal(NameOf(type, id), canonical);
        }
    }

    [Fact]
    public void Aliases_AreUnique_AndNeverTheNameOfAnotherItem()
    {
        var rows = Rows("## 1.");
        var aliases = rows.Select(r => r[0]).ToList();
        Assert.Equal(aliases.Count, aliases.Distinct().Count());

        var realNames = Data.Products.Select(p => p.Name).Concat(Data.Machines.Select(m => m.Name)).ToHashSet();
        foreach (var alias in aliases)
            Assert.DoesNotContain(alias, realNames);   // 別名若剛好是另一個物品的正式名稱，就會有歧義
    }

    [Fact]
    public void DistinctPairs_ExistAndAreReallySeparateItems()
    {
        var rows = Rows("## 2.");
        Assert.NotEmpty(rows);

        foreach (var row in rows)
        {
            var (nameA, idA, nameB, idB) = (row[0], row[1], row[2], row[3]);
            Assert.NotEqual(idA, idB);
            Assert.Equal(nameA, NameOf("物品", idA));
            Assert.Equal(nameB, NameOf("物品", idB));
        }
    }

    [Fact]
    public void Names_FollowTheWritingRules()
    {
        var names = Data.Products.Select(p => ("物品", p.Id, p.Name))
            .Concat(Data.Machines.Select(m => ("機器", m.Id, m.Name)))
            .Concat(Data.Recipes.Select(r => ("配方", r.Id, r.Name)))
            .ToList();

        foreach (var (type, id, name) in names)
        {
            Assert.False(name.Contains('汙'), $"{type} {id}「{name}」要用「污」");
            Assert.False(name.Contains("蒸氣"), $"{type} {id}「{name}」要用「蒸汽」");
            Assert.False(Regex.IsMatch(name, @"[\u4e00-\u9fff)](I{1,3}|IV)(?![A-Za-z])"), $"{type} {id}「{name}」羅馬數字前要有一個空格");
            Assert.False(name.Contains('（') || name.Contains('）'), $"{type} {id}「{name}」括號要用半形");
        }
    }
}
