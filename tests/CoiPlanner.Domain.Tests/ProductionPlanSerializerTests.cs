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
