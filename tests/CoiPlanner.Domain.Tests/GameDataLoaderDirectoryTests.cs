using CoiPlanner.Domain.Services;

namespace CoiPlanner.Domain.Tests;

public sealed class GameDataLoaderDirectoryTests : IDisposable
{
    private readonly GameDataLoader _loader = new();
    private readonly string _dir = Directory.CreateTempSubdirectory("coiplanner-tests-").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private void WriteFile(string name, string json) => File.WriteAllText(Path.Combine(_dir, name), json);

    [Fact]
    public void LoadFromDirectory_RepoDataFolder_Loads()
    {
        var data = _loader.LoadFromDirectory(Path.Combine(AppContext.BaseDirectory, "Data"));

        Assert.NotEmpty(data.Products);
    }

    [Fact]
    public void LoadFromDirectory_MergesFilesAndResolvesCrossFileReferences()
    {
        WriteFile("a.json", """{ "products": [ { "id": "a", "name": "A", "unit": "pcs" } ] }""");
        WriteFile("b.json", """
            {
              "recipes": [ { "id": "r", "name": "R", "cycleSeconds": 5,
                             "outputs": [ { "productId": "a", "quantity": 1 } ] } ],
              "machines": [ { "id": "m", "name": "M", "recipeIds": [ "r" ] } ]
            }
            """);

        var data = _loader.LoadFromDirectory(_dir);

        Assert.Single(data.Products);
        Assert.Single(data.Recipes);
        Assert.Single(data.Machines);
    }

    [Fact]
    public void LoadFromDirectory_DuplicateIdAcrossFiles_Throws()
    {
        WriteFile("a.json", """{ "products": [ { "id": "a", "name": "A", "unit": "pcs" } ] }""");
        WriteFile("b.json", """{ "products": [ { "id": "a", "name": "A2", "unit": "pcs" } ] }""");

        var ex = Assert.Throws<GameDataException>(() => _loader.LoadFromDirectory(_dir));
        Assert.Contains("product id 'a'", ex.Message);
    }

    [Fact]
    public void LoadFromDirectory_MalformedFile_MessageNamesFile()
    {
        WriteFile("good.json", """{ "products": [] }""");
        WriteFile("broken.json", "{ \"products\": [ ");

        var ex = Assert.Throws<GameDataException>(() => _loader.LoadFromDirectory(_dir));
        Assert.StartsWith("broken.json", ex.Message);
    }

    [Fact]
    public void LoadFromDirectory_NoJsonFiles_Throws()
    {
        Assert.Throws<GameDataException>(() => _loader.LoadFromDirectory(_dir));
    }

    [Fact]
    public void LoadFromDirectory_MissingDirectory_Throws()
    {
        Assert.Throws<GameDataException>(() => _loader.LoadFromDirectory(Path.Combine(_dir, "nope")));
    }
}
