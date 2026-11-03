using Microsoft.Playwright;

namespace {Namespace}.Services
{
    /// <summary>
    /// Abstraction over Playwright browser launch so tests don't depend on a concrete browser.
    /// </summary>
    public interface IBrowserService : IAsyncDisposable
    {
        Task<IBrowser> LaunchAsync();
    }
}
