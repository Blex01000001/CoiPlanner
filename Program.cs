using CoiPlanner.Components;
using CoiPlanner.Domain.Services;
using MudBlazor.Services;

var builder = WebApplication.CreateBuilder(args);

// 程序因未處理的例外結束時，主控台視窗可能直接關閉（例如 Visual Studio 停止偵錯時），看不到訊息；
// 另外寫一份到 logs/crash.log，事後才查得到原因
AppDomain.CurrentDomain.UnhandledException += (_, e) => CrashLog.Write(builder.Environment.ContentRootPath, e.ExceptionObject);
TaskScheduler.UnobservedTaskException += (_, e) => CrashLog.Write(builder.Environment.ContentRootPath, e.Exception);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents(options => options.DetailedErrors = builder.Environment.IsDevelopment());

// 預設單一 SignalR 訊息上限 32 KB；規劃稍大時，畫布送回 C# 的規劃、讀回的自動存檔、
// 拖放匯入的檔案內容都會超過，超過時連線會直接中斷。放寬到與匯入上限（1 MB）相符
builder.Services.AddSignalR(options => options.MaximumReceiveMessageSize = 2 * 1024 * 1024);

builder.Services.AddMudServices();

// 啟動時載入一次 Data/*.json；資料有誤會直接拋出 GameDataException，讓問題在啟動時就被發現
var gameData = new GameDataLoader().LoadFromDirectory(Path.Combine(builder.Environment.ContentRootPath, "Data"));
builder.Services.AddSingleton(gameData);
builder.Services.AddSingleton(new PlanCalculator(gameData));
builder.Services.AddSingleton<ProductionPlanSerializer>();

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

static class CrashLog
{
    public static void Write(string contentRoot, object exception)
    {
        try
        {
            var dir = Path.Combine(contentRoot, "logs");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "crash.log"), $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {exception}{Environment.NewLine}{Environment.NewLine}");
        }
        catch
        {
            // 記錄失敗時不能再丟例外，否則會蓋掉原本的錯誤
        }
    }
}
