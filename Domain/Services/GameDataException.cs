namespace CoiPlanner.Domain.Services;

/// <summary>遊戲資料 JSON 格式錯誤或內容不一致。</summary>
public sealed class GameDataException : Exception
{
    public GameDataException(string message) : base(message) { }
    public GameDataException(string message, Exception inner) : base(message, inner) { }
}
