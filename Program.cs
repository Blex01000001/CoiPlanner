using CoiPlanner.Components;
using CoiPlanner.Domain.Services;
using MudBlazor.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

builder.Services.AddMudServices();

// 啟動時載入一次 Data/*.json；資料有誤會直接拋出 GameDataException，讓問題在啟動時就被發現
var gameData = new GameDataLoader().LoadFromDirectory(Path.Combine(builder.Environment.ContentRootPath, "Data"));
builder.Services.AddSingleton(gameData);
builder.Services.AddSingleton(new PlanCalculator(gameData));

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseHttpsRedirection();

app.UseStaticFiles();
app.UseAntiforgery();

app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
