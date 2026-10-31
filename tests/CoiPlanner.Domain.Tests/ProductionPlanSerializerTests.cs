using CoiPlanner.Domain.Models;
using CoiPlanner.Domain.Services;
using static CoiPlanner.Domain.Tests.TestData;

namespace CoiPlanner.Domain.Tests;

public class ProductionPlanSerializerTests
{
    private readonly ProductionPlanSerializer _serializer = new();

    [Fact]
    public void SerializeThenDeserialize_RoundTrips()
    {
        var plan = new ProductionPlan
        {
            Nodes = [Furnace(count: 3), Press(count: 2)],
            Edges = [Link("f", "p", "beta_ingot")],
        };

        var restored = _serializer.Deserialize(_serializer.Serialize(plan));

        Assert.Equal(plan.Nodes, restored.Nodes);
        Assert.Equal(plan.Edges, restored.Edges);
    }

    [Fact]
    public void SerializeThenDeserialize_KeepsGroupsAndNotes()
    {
        var plan = new ProductionPlan
        {
            Groups = [new PlanGroup { Title = "煉鋼區", X = -20, Y = 40, Width = 600, Height = 300, Color = "#b58b2a" }],
            Notes = [new PlanNote { Id = "9", Title = "待辦", Text = "第一行\n第二行", X = 10, Y = 20, Width = 260, Height = 120, Color = "yellow" }],
        };

        var restored = _serializer.Deserialize(_serializer.Serialize(plan));

        Assert.Equal(plan.Groups, restored.Groups);
        Assert.Equal(plan.Notes, restored.Notes);
    }

    [Fact]
    public void Deserialize_OldPlanWithoutGroupsOrNotes_HasEmptyLists()
    {
        var plan = _serializer.Deserialize("""{ "nodes": [], "edges": [] }""");

        Assert.Empty(plan.Groups);
        Assert.Empty(plan.Notes);
    }

    [Fact]
    public void Calculate_IgnoresGroupsAndNotes()
    {
        var plan = new ProductionPlan
        {
            Nodes = [Furnace()],
            Groups = [new PlanGroup { Title = "G" }],
            Notes = [new PlanNote { Id = "n" }],
        };

        var result = new PlanCalculator(Sample).Calculate(plan);

        Assert.True(result.IsValid);
        Assert.Single(result.Nodes);
    }

    [Fact]
    public void Serialize_UsesCamelCase()
    {
        var json = _serializer.Serialize(new ProductionPlan { Nodes = [Furnace()] });

        Assert.Contains("\"machineId\"", json);
    }

    [Fact]
    public void Deserialize_Malformed_ThrowsGameDataException()
    {
        Assert.Throws<GameDataException>(() => _serializer.Deserialize("{ \"nodes\": [ "));
    }

    [Fact]
    public void Deserialize_Null_ThrowsGameDataException()
    {
        Assert.Throws<GameDataException>(() => _serializer.Deserialize("null"));
    }
}
