using Microsoft.AspNetCore.SignalR;
using PlaywrightRecorder.Api.Models;

namespace PlaywrightRecorder.Api.Hubs;

public class RecordingHub : Hub
{
    public Task JoinSession(string sessionId)
        => Groups.AddToGroupAsync(Context.ConnectionId, sessionId);

    public Task LeaveSession(string sessionId)
        => Groups.RemoveFromGroupAsync(Context.ConnectionId, sessionId);
}

public interface IRecordingHubBroadcaster
{
    Task ActionRecordedAsync(string sessionId, RecordedAction action);
    Task ScreenshotFrameAsync(string sessionId, string base64Png);
    Task TreeUpdatedAsync();
    Task RecordingStoppedAsync(string sessionId, IEnumerable<GeneratedFileResult> generated);
}

public sealed class RecordingHubBroadcaster : IRecordingHubBroadcaster
{
    private readonly IHubContext<RecordingHub> _hub;
    public RecordingHubBroadcaster(IHubContext<RecordingHub> hub) => _hub = hub;

    public Task ActionRecordedAsync(string sessionId, RecordedAction action)
        => _hub.Clients.Group(sessionId).SendAsync("actionRecorded", action);

    public Task ScreenshotFrameAsync(string sessionId, string base64Png)
        => _hub.Clients.Group(sessionId).SendAsync("screenshotFrame", base64Png);

    public Task TreeUpdatedAsync()
        => _hub.Clients.All.SendAsync("treeUpdated");

    public Task RecordingStoppedAsync(string sessionId, IEnumerable<GeneratedFileResult> generated)
        => _hub.Clients.Group(sessionId).SendAsync("recordingStopped", generated);
}
