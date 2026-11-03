#nullable disable
using System;
using System.IO;
using System.Threading.Tasks;
using Memento.UxTests.Infrastructure.Interfaces;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Shared.Extensions;
using Memento.UxTests.Shared.Helpers;
using Microsoft.Playwright;

namespace Memento.UxTests.Infrastructure.Services
{
    /// <summary>
    /// Default <see cref="IBrowserManager"/>. Reads its preferences from
    /// <see cref="MementoSettings"/> (hydrated by
    /// <see cref="AppConfigurationExtensions.LoadMementoSettings"/> at
    /// process start). Supports the same browser-engine routing memento's
    /// own BrowserManager uses:
    ///   • <c>UseChromium = true</c> always launches vanilla Chromium with
    ///     no channel — the legacy default.
    ///   • <c>UseChromium = false</c> routes by
    ///     <see cref="MementoSettings.DefaultBrowser"/>:
    ///       - "firefox"  → Playwright Firefox
    ///       - "webkit"   → Playwright WebKit
    ///       - "chromium" → Playwright Chromium, no channel
    ///       - any other value (chrome, msedge, msedge-beta, ...) is
    ///         treated as a Chromium channel name.
    /// </summary>
    public class BrowserManager : IBrowserManager, IDisposable
    {
        private const string TimestampFormat = "yyyyMMdd_HHmmss";
        private enum BrowserEngine { Chromium, Firefox, Webkit }

        private IPlaywright _playwright;
        private IBrowser _browser;
        private IBrowserContext _context;
        private IPage _page;

        public IPage page => _page;
        public IBrowser Browser => _browser;
        public IBrowserContext Context => _context;
        public IPlaywright playwright => _playwright;
        public bool TracingStarted { get; private set; }

        public BrowserManager()
        {
        }

        public Task LaunchBrowserAsync() => LaunchBrowserAsync(new BrowserNewContextOptions());

        public async Task LaunchBrowserAsync(BrowserNewContextOptions contextOptions)
        {
            var launchOptions = InitBrowserType();
            await InitPageAsync(launchOptions, contextOptions);
        }

        public BrowserTypeLaunchOptions InitBrowserType()
        {
            var options = new BrowserTypeLaunchOptions
            {
                Headless = MementoSettings.RunHeadless,
            };

            // Channel only applies to the Chromium engine and only when the
            // user picked a real channel name (chrome / msedge / msedge-beta).
            if (MementoSettings.UseChromium)
            {
                return options;
            }

            var engine = ResolveEngine(MementoSettings.DefaultBrowser);
            if (engine == BrowserEngine.Chromium &&
                !string.Equals(MementoSettings.DefaultBrowser, "chromium",
                    StringComparison.OrdinalIgnoreCase))
            {
                options.Channel = MementoSettings.DefaultBrowser;
            }
            return options;
        }

        private async Task InitPageAsync(
            BrowserTypeLaunchOptions launchOptions,
            BrowserNewContextOptions contextOptions)
        {
            _playwright = await Playwright.CreateAsync();

            var engine = MementoSettings.UseChromium
                ? BrowserEngine.Chromium
                : ResolveEngine(MementoSettings.DefaultBrowser);

            _browser = engine switch
            {
                BrowserEngine.Firefox => await _playwright.Firefox.LaunchAsync(launchOptions),
                BrowserEngine.Webkit  => await _playwright.Webkit.LaunchAsync(launchOptions),
                _                     => await _playwright.Chromium.LaunchAsync(launchOptions),
            };

            _context = await _browser.NewContextAsync(contextOptions ?? new BrowserNewContextOptions());
            _context.SetDefaultTimeout(MementoSettings.PlaywrightTimeout);
            _page = await _context.NewPageAsync();
        }

        private static BrowserEngine ResolveEngine(string preference)
        {
            if (string.IsNullOrWhiteSpace(preference)) return BrowserEngine.Chromium;
            if (string.Equals(preference, "firefox", StringComparison.OrdinalIgnoreCase))
                return BrowserEngine.Firefox;
            if (string.Equals(preference, "webkit", StringComparison.OrdinalIgnoreCase))
                return BrowserEngine.Webkit;
            return BrowserEngine.Chromium;
        }

        public async Task TakeScreenshotAsync(IPage page, TestOutputLogger logger)
        {
            try
            {
                var dir = ScreenshotsDirectory();
                Directory.CreateDirectory(dir);
                var filename = $"{SanitizeForFilename(NUnit.Framework.TestContext.CurrentContext.Test.Name)}_" +
                               $"{DateTime.UtcNow.ToString(TimestampFormat)}.png";
                var path = Path.Combine(dir, filename);
                await page.ScreenshotAsync(new PageScreenshotOptions { Path = path, FullPage = true });
                logger.Info($"Saved failure screenshot: {path}");
                NUnit.Framework.TestContext.AddTestAttachment(path, "failure screenshot");
            }
            catch (Exception ex)
            {
                logger.Warn($"Could not save screenshot: {ex.Message}");
            }
        }

        public async Task StartTracingAsync()
        {
            if (_context == null) return;
            await _context.Tracing.StartAsync(new()
            {
                Screenshots = true,
                Snapshots = true,
                Sources = true,
            });
            TracingStarted = true;
        }

        public async Task StopTracingAsync(IPage page, bool uploadTracer, TestOutputLogger logger)
        {
            if (_context == null || !TracingStarted) return;
            try
            {
                var dir = TracesDirectory();
                Directory.CreateDirectory(dir);
                var filename = $"{SanitizeForFilename(NUnit.Framework.TestContext.CurrentContext.Test.Name)}_" +
                               $"{DateTime.UtcNow.ToString(TimestampFormat)}.zip";
                var path = Path.Combine(dir, filename);
                await _context.Tracing.StopAsync(new() { Path = path });
                TracingStarted = false;
                logger.Info($"Saved Playwright trace: {path}");
                NUnit.Framework.TestContext.AddTestAttachment(path, "playwright trace");
                if (uploadTracer)
                {
                    var url = await PlaywrightTraceExtensions.UploadPlaywrightTraceAsync(path);
                    if (!string.IsNullOrEmpty(url)) logger.Info($"Uploaded trace: {url}");
                }
            }
            catch (Exception ex)
            {
                logger.Warn($"Could not stop tracing: {ex.Message}");
            }
        }

        private static string ScreenshotsDirectory() =>
            Path.Combine(NUnit.Framework.TestContext.CurrentContext.WorkDirectory,
                "TestResults", "Screenshots");

        private static string TracesDirectory() =>
            Path.Combine(NUnit.Framework.TestContext.CurrentContext.WorkDirectory,
                "TestResults", "Traces");

        private static string SanitizeForFilename(string raw)
        {
            foreach (var ch in Path.GetInvalidFileNameChars())
            {
                raw = raw.Replace(ch, '_');
            }
            return raw;
        }

        public void Dispose()
        {
            // Per-test cleanup goes through TestFixture.DisposePlaywrightAsync.
            GC.SuppressFinalize(this);
        }
    }
}
