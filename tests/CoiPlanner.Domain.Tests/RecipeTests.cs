using CoiPlanner.Domain.Models;

namespace CoiPlanner.Domain.Tests;

public class RecipeTests
{
    private static Recipe MakeRecipe(double cycleSeconds) => new()
    {
        Id = "r",
        Name = "R",
        CycleSeconds = cycleSeconds,
        Inputs = [new ItemAmount { ProductId = "in", Quantity = 3 }],
        Outputs = [new ItemAmount { ProductId = "out", Quantity = 2 }],
    };

    [Fact]
    public void CyclesPerMinute_ConvertsFromSeconds()
    {
        Assert.Equal(3, MakeRecipe(20).CyclesPerMinute);
    }

    [Fact]
    public void PerMinuteRates_ScaleQuantityByCycles()
    {
        var recipe = MakeRecipe(20);

        Assert.Equal(9, recipe.InputPerMinute("in"));
        Assert.Equal(6, recipe.OutputPerMinute("out"));
    }

    [Fact]
    public void PerMinuteRates_UnusedProduct_IsZero()
    {
        var recipe = MakeRecipe(20);

        Assert.Equal(0, recipe.InputPerMinute("out"));
        Assert.Equal(0, recipe.OutputPerMinute("in"));
    }
}
