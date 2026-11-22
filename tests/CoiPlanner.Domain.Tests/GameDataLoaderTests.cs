using CoiPlanner.Domain.Services;

namespace CoiPlanner.Domain.Tests;

public class GameDataLoaderTests
{
    private readonly GameDataLoader _loader = new();

    private static string SamplePath => Path.Combine(AppContext.BaseDirectory, "Fixtures", "sample.json");

    [Fact]
    public void LoadFromFile_SampleJson_LoadsAllSections()
    {
        var data = _loader.LoadFromFile(SamplePath);

        Assert.Equal(5, data.Products.Count);
        Assert.Equal(4, data.Recipes.Count);
        Assert.Equal(4, data.Machines.Count);
    }

    [Fact]
    public void LoadFromFile_SampleJson_MapsRecipeFields()
    {
        var data = _loader.LoadFromFile(SamplePath);

        var recipe = Assert.Single(data.Recipes, r => r.Id == "smelt_beta");
        Assert.Equal(10, recipe.CycleSeconds);
        var input = Assert.Single(recipe.Inputs);
        Assert.Equal("alpha_ore", input.ProductId);
        Assert.Equal(2, input.Quantity);
        var output = Assert.Single(recipe.Outputs);
        Assert.Equal("beta_ingot", output.ProductId);
        Assert.Equal(1, output.Quantity);
    }

    [Fact]
    public void LoadFromFile_SampleJson_MapsPower()
    {
        var data = new GameDataLoader().LoadFromFile(Path.Combine(AppContext.BaseDirectory, "Fixtures", "sample.json"));

        Assert.Equal(150, data.Machines.Single(m => m.Id == "demo_drill").PowerUseKw);
        Assert.Equal(200, data.Machines.Single(m => m.Id == "demo_generator").PowerGenerationKw);
        Assert.Equal(0, data.Machines.Single(m => m.Id == "demo_press").PowerUseKw);
    }

    [Fact]
    public void LoadFromFile_SampleJson_MapsWorkersAndMaintenance()
    {
        var data = new GameDataLoader().LoadFromFile(Path.Combine(AppContext.BaseDirectory, "Fixtures", "sample.json"));

        var press = data.Machines.Single(m => m.Id == "demo_press");
        Assert.Equal(2, press.Workers);
        Assert.Equal("M1", press.MaintenanceType);
        Assert.Equal(0.5, press.MaintenancePerMinute);
        Assert.Equal(0, data.Machines.Single(m => m.Id == "demo_furnace").Workers);
        Assert.Null(data.Machines.Single(m => m.Id == "demo_furnace").MaintenanceType);
    }

    [Fact]
    public void LoadFromFile_SampleJson_MapsMachineRecipes()
    {
        var data = _loader.LoadFromFile(SamplePath);

        var machine = Assert.Single(data.Machines, m => m.Id == "demo_press");
        Assert.True(machine.CanRun("press_gamma"));
        Assert.False(machine.CanRun("smelt_beta"));
    }

    [Fact]
    public void Parse_AllowsCommentsAndTrailingCommas()
    {
        const string json = """
            {
              // 註解
              "products": [ { "id": "a", "name": "A", "unit": "pcs" }, ],
            }
            """;

        var data = _loader.Parse(json);

        Assert.Single(data.Products);
        Assert.Empty(data.Recipes);
    }

    [Fact]
    public void Parse_ProductColor_IsLoaded()
    {
        var data = _loader.Parse("""{ "products": [ { "id": "a", "name": "A", "unit": "pcs", "color": "#4fc3f7" } ] }""");

        Assert.Equal("#4fc3f7", Assert.Single(data.Products).Color);
    }

    [Theory]
    [InlineData("blue")]
    [InlineData("#abc")]
    [InlineData("4fc3f7")]
    public void Parse_InvalidProductColor_ThrowsGameDataException(string color)
    {
        var ex = Assert.Throws<GameDataException>(() =>
            _loader.Parse($$"""{ "products": [ { "id": "a", "name": "A", "unit": "pcs", "color": "{{color}}" } ] }"""));

        Assert.Contains("color", ex.Message);
    }

    [Theory]
    [InlineData("\"workers\": -1")]
    [InlineData("\"maintenanceType\": \"M1\", \"maintenancePerMinute\": -0.1")]
    [InlineData("\"maintenancePerMinute\": 0.2")]
    public void Parse_InvalidWorkersOrMaintenance_ThrowsGameDataException(string fields)
    {
        var ex = Assert.Throws<GameDataException>(() =>
            _loader.Parse($$"""{ "machines": [ { "id": "m", "name": "M", {{fields}} } ] }"""));

        Assert.Contains("machine 'm'", ex.Message);
    }

    [Fact]
    public void Parse_MalformedJson_ThrowsGameDataException()
    {
        Assert.Throws<GameDataException>(() => _loader.Parse("{ \"products\": [ "));
    }

    [Fact]
    public void Parse_NullJson_ThrowsGameDataException()
    {
        Assert.Throws<GameDataException>(() => _loader.Parse("null"));
    }

    [Fact]
    public void Parse_MissingRequiredField_ThrowsGameDataException()
    {
        const string json = """{ "products": [ { "id": "a", "name": "A" } ] }""";

        Assert.Throws<GameDataException>(() => _loader.Parse(json));
    }

    [Fact]
    public void Parse_DuplicateProductId_ThrowsWithMessage()
    {
        const string json = """
            { "products": [
                { "id": "a", "name": "A", "unit": "pcs" },
                { "id": "a", "name": "A2", "unit": "pcs" } ] }
            """;

        var ex = Assert.Throws<GameDataException>(() => _loader.Parse(json));
        Assert.Contains("product id 'a'", ex.Message);
    }

    [Fact]
    public void Parse_RecipeReferencesUnknownProduct_Throws()
    {
        const string json = """
            {
              "products": [ { "id": "a", "name": "A", "unit": "pcs" } ],
              "recipes": [ {
                "id": "r", "name": "R", "cycleSeconds": 5,
                "inputs": [ { "productId": "a", "quantity": 1 } ],
                "outputs": [ { "productId": "missing", "quantity": 1 } ] } ]
            }
            """;

        var ex = Assert.Throws<GameDataException>(() => _loader.Parse(json));
        Assert.Contains("'missing'", ex.Message);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Parse_NonPositiveCycleSeconds_Throws(double cycleSeconds)
    {
        var json = $$"""
            { "recipes": [ { "id": "r", "name": "R", "cycleSeconds": {{cycleSeconds}} } ] }
            """;

        var ex = Assert.Throws<GameDataException>(() => _loader.Parse(json));
        Assert.Contains("cycleSeconds", ex.Message);
    }

    [Fact]
    public void Parse_NonPositiveQuantity_Throws()
    {
        const string json = """
            {
              "products": [ { "id": "a", "name": "A", "unit": "pcs" } ],
              "recipes": [ {
                "id": "r", "name": "R", "cycleSeconds": 5,
                "outputs": [ { "productId": "a", "quantity": 0 } ] } ]
            }
            """;

        var ex = Assert.Throws<GameDataException>(() => _loader.Parse(json));
        Assert.Contains("quantity", ex.Message);
    }

    [Fact]
    public void Parse_MachineReferencesUnknownRecipe_Throws()
    {
        const string json = """
            { "machines": [ { "id": "m", "name": "M", "recipeIds": [ "nope" ] } ] }
            """;

        var ex = Assert.Throws<GameDataException>(() => _loader.Parse(json));
        Assert.Contains("'nope'", ex.Message);
    }
}
