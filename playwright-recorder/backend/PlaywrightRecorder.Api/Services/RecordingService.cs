using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Playwright;
using PlaywrightRecorder.Api.Hubs;
using PlaywrightRecorder.Api.Models;

namespace PlaywrightRecorder.Api.Services;

public interface IRecordingService
{
    Task<RecordingSessionInfo> StartAsync(StartRecordingRequest request, CancellationToken ct = default);
    Task<IEnumerable<GeneratedFileResult>> StopAsync(string sessionId, ProjectInfo project);
}

internal sealed class RecordingSession : IAsyncDisposable
{
    public string SessionId { get; init; } = "";
    public StartRecordingRequest Request { get; init; } = null!;
    public IPlaywright Playwright { get; init; } = null!;
    public IBrowser Browser { get; init; } = null!;
    public IBrowserContext Context { get; init; } = null!;
    public IPage Page { get; init; } = null!;
    public List<RecordedAction> Actions { get; } = new();
    public CancellationTokenSource Cts { get; } = new();

    public async ValueTask DisposeAsync()
    {
        Cts.Cancel();
        try { await Context.CloseAsync(); } catch { }
        try { await Browser.CloseAsync(); } catch { }
        Playwright.Dispose();
        Cts.Dispose();
    }
}

public sealed class RecordingService : IRecordingService
{
    private readonly IHubContext<RecordingHub> _hub;
    private readonly IConfiguration _config;
    private readonly ICodeGenerationService _codegen;
    private readonly ConcurrentDictionary<string, RecordingSession> _sessions = new();

    public RecordingService(IHubContext<RecordingHub> hub, IConfiguration config, ICodeGenerationService codegen)
    {
        _hub = hub;
        _config = config;
        _codegen = codegen;
    }

    public async Task<RecordingSessionInfo> StartAsync(StartRecordingRequest request, CancellationToken ct = default)
    {
        var sessionId = Guid.NewGuid().ToString("N");
        var headless = bool.TryParse(_config["Recording:Headless"], out var h) && h;
        var browserName = _config["DefaultBrowser"] ?? "Edge";

        var pw = await Playwright.CreateAsync();
        var launchOpts = new BrowserTypeLaunchOptions { Headless = headless };
        IBrowser browser = browserName.ToLowerInvariant() switch
        {
            "edge"     => await pw.Chromium.LaunchAsync(new BrowserTypeLaunchOptions { Channel = "msedge", Headless = headless }),
            "chrome"   => await pw.Chromium.LaunchAsync(new BrowserTypeLaunchOptions { Channel = "chrome", Headless = headless }),
            "firefox"  => await pw.Firefox.LaunchAsync(launchOpts),
            "webkit"   => await pw.Webkit.LaunchAsync(launchOpts),
            _          => await pw.Chromium.LaunchAsync(new BrowserTypeLaunchOptions { Channel = "msedge", Headless = headless })
        };

        var context = await browser.NewContextAsync();
        var page = await context.NewPageAsync();

        var session = new RecordingSession
        {
            SessionId = sessionId,
            Request = request,
            Playwright = pw,
            Browser = browser,
            Context = context,
            Page = page
        };

        await InjectInteractionRecorder(page, session);

        page.FrameNavigated += async (_, frame) =>
        {
            if (frame != page.MainFrame) return;
            var action = new RecordedAction(
                Guid.NewGuid().ToString("N"),
                DerivePageName(frame.Url),
                "navigate",
                frame.Url,
                "url",
                null,
                frame.Url,
                DateTime.UtcNow);
            session.Actions.Add(action);
            await _hub.Clients.Group(sessionId).SendAsync("actionRecorded", action);
            await InjectInteractionRecorder(page, session);
        };

        page.Console += (_, msg) =>
        {
            if (!msg.Text.StartsWith("__PWREC__")) return;
            try
            {
                var json = msg.Text["__PWREC__".Length..];
                var doc = System.Text.Json.JsonDocument.Parse(json);
                var root = doc.RootElement;
                var action = new RecordedAction(
                    Guid.NewGuid().ToString("N"),
                    DerivePageName(page.Url),
                    root.GetProperty("type").GetString() ?? "click",
                    root.GetProperty("selector").GetString() ?? "",
                    root.GetProperty("strategy").GetString() ?? "css",
                    root.TryGetProperty("value", out var v) ? v.GetString() : null,
                    page.Url,
                    DateTime.UtcNow);
                session.Actions.Add(action);
                _ = _hub.Clients.Group(sessionId).SendAsync("actionRecorded", action);
            }
            catch { /* ignore malformed */ }
        };

        _sessions[sessionId] = session;

        if (!string.IsNullOrWhiteSpace(request.StartUrl))
            await page.GotoAsync(request.StartUrl);

        _ = Task.Run(() => StreamScreenshotsAsync(session), session.Cts.Token);

        return new RecordingSessionInfo(sessionId, "running");
    }

    public async Task<IEnumerable<GeneratedFileResult>> StopAsync(string sessionId, ProjectInfo project)
    {
        if (!_sessions.TryRemove(sessionId, out var session))
            return Array.Empty<GeneratedFileResult>();

        var generated = new List<GeneratedFileResult>();

        var byPage = session.Actions
            .Where(a => a.ActionType is "click" or "fill" or "check" or "select")
            .GroupBy(a => string.IsNullOrWhiteSpace(a.PageName) ? "Page" : a.PageName);

        foreach (var pageGroup in byPage)
        {
            var pageName = SanitizeIdentifier(pageGroup.Key) + "Page";
            var selectors = new Dictionary<string, string>();
            var actions = new List<PageObjectAction>();
            var index = 0;

            foreach (var a in pageGroup)
            {
                var key = SanitizeIdentifier($"{a.SelectorStrategy}_{index++}");
                selectors[key] = a.Selector;
                actions.Add(new PageObjectAction(
                    MethodName: BuildMethodName(a.ActionType, key),
                    SelectorKey: key,
                    ActionType: a.ActionType,
                    ParameterName: a.ActionType == "fill" ? "value" : null,
                    ParameterType: a.ActionType == "fill" ? "string" : null));
            }

            var results = _codegen.GeneratePageObject(new GeneratePageObjectRequest(
                pageName,
                project.DefaultNamespace,
                session.Request.PageObjectsFolder,
                selectors,
                actions));
            generated.AddRange(results);
        }

        if (File.Exists(session.Request.TargetClassFilePath))
        {
            var addMethod = _codegen.AddTestMethod(new GenerateTestMethodRequest(
                session.Request.TargetClassFilePath,
                session.Request.TestMethodName));
            generated.Add(addMethod);
        }

        await _hub.Clients.Group(sessionId).SendAsync("recordingStopped", generated);
        await session.DisposeAsync();
        return generated;
    }

    private async Task StreamScreenshotsAsync(RecordingSession session)
    {
        var interval = int.TryParse(_config["Recording:ScreenshotIntervalMs"], out var ms) ? ms : 100;
        while (!session.Cts.IsCancellationRequested)
        {
            try
            {
                var bytes = await session.Page.ScreenshotAsync(new PageScreenshotOptions
                {
                    Type = ScreenshotType.Png,
                    FullPage = false
                });
                var b64 = Convert.ToBase64String(bytes);
                await _hub.Clients.Group(session.SessionId).SendAsync("screenshotFrame", b64);
            }
            catch
            {
                // page may be navigating/closed; just skip this frame
            }
            await Task.Delay(interval);
        }
    }

    private static async Task InjectInteractionRecorder(IPage page, RecordingSession session)
    {
        const string js = @"
(() => {
    if (window.__PWREC_INSTALLED) return;
    window.__PWREC_INSTALLED = true;

    function pickSelector(el) {
        if (!el || el.nodeType !== 1) return { strategy: 'css', selector: '' };
        if (el.getAttribute('data-testid')) return { strategy: 'data-testid', selector: `[data-testid='${el.getAttribute('data-testid')}']` };
        if (el.id) return { strategy: 'id', selector: `#${el.id}` };
        if (el.getAttribute('aria-label')) return { strategy: 'aria-label', selector: `[aria-label='${el.getAttribute('aria-label')}']` };
        // css fallback
        const parts = [];
        let cur = el;
        while (cur && cur.nodeType === 1 && parts.length < 5) {
            let sel = cur.tagName.toLowerCase();
            if (cur.className && typeof cur.className === 'string') {
                const cls = cur.className.trim().split(/\s+/).slice(0, 2).join('.');
                if (cls) sel += '.' + cls;
            }
            parts.unshift(sel);
            cur = cur.parentElement;
        }
        return { strategy: 'css', selector: parts.join(' > ') };
    }

    document.addEventListener('click', (ev) => {
        const t = ev.target;
        const s = pickSelector(t);
        console.log('__PWREC__' + JSON.stringify({ type: 'click', selector: s.selector, strategy: s.strategy }));
    }, true);

    document.addEventListener('change', (ev) => {
        const t = ev.target;
        if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)) return;
        const s = pickSelector(t);
        const type = t instanceof HTMLSelectElement ? 'select' : (t.type === 'checkbox' ? 'check' : 'fill');
        console.log('__PWREC__' + JSON.stringify({ type, selector: s.selector, strategy: s.strategy, value: t.value }));
    }, true);
})();
";
        try { await page.EvaluateAsync(js); } catch { }
    }

    private static string DerivePageName(string url)
    {
        try
        {
            var uri = new Uri(url);
            var seg = uri.Segments.LastOrDefault(s => s.Trim('/').Length > 0)?.Trim('/');
            return SanitizeIdentifier(string.IsNullOrWhiteSpace(seg) ? uri.Host.Split('.').First() : seg);
        }
        catch { return "Page"; }
    }

    private static string BuildMethodName(string actionType, string key)
    {
        var verb = actionType switch
        {
            "fill" => "Enter",
            "click" => "Click",
            "check" => "Check",
            "select" => "Select",
            _ => "Do"
        };
        return verb + key;
    }

    private static string SanitizeIdentifier(string value)
    {
        var clean = new string(value.Select(c => char.IsLetterOrDigit(c) ? c : '_').ToArray());
        if (string.IsNullOrEmpty(clean)) clean = "Item";
        if (char.IsDigit(clean[0])) clean = "_" + clean;
        return char.ToUpperInvariant(clean[0]) + clean[1..];
    }
}
