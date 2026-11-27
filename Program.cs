using CoiPlanner;
using CoiPlanner.Components;
using CoiPlanner.Domain.Services;
using CoiPlanner.Services;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using MudBlazor.Services;

// 靜態網站：整個程式在瀏覽器裡以 WebAssembly 執行，沒有伺服器
var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<Routes>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

// 提示訊息放在下方中央，避免蓋住產線規劃頁右上角的模擬控制列
builder.Services.AddMudServices(config =>
    config.SnackbarConfiguration.PositionClass = MudBlazor.Defaults.Classes.Position.BottomCenter);

// 啟動時載入一次 Data/*.json（編在組件裡）；資料有誤會直接拋出 GameDataException，讓問題在啟動時就被發現
var gameData = new GameDataLoader().LoadFromAssembly(typeof(Program).Assembly);
builder.Services.AddSingleton(gameData);
builder.Services.AddSingleton(new PlanCalculator(gameData));
builder.Services.AddSingleton(new RecipeCostCalculator(gameData));
builder.Services.AddSingleton<ProductionPlanSerializer>();
builder.Services.AddSingleton<BrowserStorage>();

await builder.Build().RunAsync();
