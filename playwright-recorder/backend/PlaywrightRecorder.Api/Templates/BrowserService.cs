using Microsoft.Extensions.Configuration;
using Microsoft.Playwright;

namespace {Namespace}.Services
{
    /// <summary>
    /// Default browser service. Launches Microsoft Edge via Playwright by default.
    /// Override the "DefaultBrowser" key in appsettings.json to switch (Edge | Chromium | Firefox | Webkit).
    /// </summary>
    public sealed class BrowserService : IBrowserService
    {
        private readonly IConfiguration _configuration;
        private IPlaywright? _playwright;

        public BrowserService(IConfiguration configuration)
        {
            _configuration = configuration;
        }

        public async Task<IBrowser> LaunchAsync()
        {
            _playwright ??= await Playwright.CreateAsync();
            var browserName = _configuration["DefaultBrowser"] ?? "Edge";
            var headless = bool.TryParse(_configuration["Headless"], out var h) ? h : false;

            var launchOptions = new BrowserTypeLaunchOptions { Headless = headless };

            return browserName.ToLowerInvariant() switch
            {
                "edge"     => await _playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions { Channel = "msedge", Headless = headless }),
                "chrome"   => await _playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions { Channel = "chrome", Headless = headless }),
                "chromium" => await _playwright.Chromium.LaunchAsync(launchOptions),
                "firefox"  => await _playwright.Firefox.LaunchAsync(launchOptions),
                "webkit"   => await _playwright.Webkit.LaunchAsync(launchOptions),
                _          => await _playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions { Channel = "msedge", Headless = headless })
            };
        }

        public ValueTask DisposeAsync()
        {
            _playwright?.Dispose();
            _playwright = null;
            return ValueTask.CompletedTask;
        }
    }
}
