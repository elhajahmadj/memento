using System.Threading.Tasks;
using Memento.UxTests.Shared.Helpers;
using Microsoft.Playwright;

namespace Memento.UxTests.Infrastructure.Interfaces
{
    /// <summary>
    /// Per-test owner of the Playwright handle and browser/context/page
    /// lifecycle. Mirrors the contract memento itself emits in its
    /// Default C# architecture so this UX suite is shaped exactly like a
    /// recording memento would have produced.
    /// </summary>
    public interface IBrowserManager
    {
        IPlaywright? playwright { get; }
        IBrowser? Browser { get; }
        IBrowserContext? Context { get; }
        IPage? page { get; }
        bool TracingStarted { get; }

        Task LaunchBrowserAsync();

        /// <summary>
        /// Launch with reusable storage state so a role's session cookie
        /// survives across tests and the test itself doesn't need to log
        /// in over the UI every time.
        /// </summary>
        Task LaunchBrowserAsync(BrowserNewContextOptions contextOptions);

        Task TakeScreenshotAsync(IPage page, TestOutputLogger logger);
        Task StartTracingAsync();
        Task StopTracingAsync(IPage page, bool uploadTracer, TestOutputLogger logger);
    }
}
