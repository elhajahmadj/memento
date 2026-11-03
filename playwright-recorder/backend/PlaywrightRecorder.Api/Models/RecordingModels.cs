namespace PlaywrightRecorder.Api.Models;

public sealed record StartRecordingRequest(
    string TargetClassFilePath,                     // absolute .cs path of the [TestFixture]
    string TestMethodName,
    string Namespace,
    string PageObjectsFolder,
    string StartUrl);

public sealed record StopRecordingRequest(string SessionId);

public sealed record RecordedAction(
    string Id,
    string PageName,
    string ActionType,                              // click | fill | navigate | check | select
    string Selector,
    string SelectorStrategy,                        // data-testid | id | aria-label | css
    string? Value,
    string? Url,
    DateTime Timestamp);

public sealed record RecordingSessionInfo(string SessionId, string Status);
