using System.Threading.Tasks;

namespace Memento.UxTests.Shared.Extensions
{
    /// <summary>
    /// Optional hook for shipping a local trace zip to a remote viewer.
    /// Mirrors memento's own <c>PlaywrightTraceExtensions</c>: a static
    /// helper rather than an extension on <c>string</c> so it doesn't
    /// pollute IntelliSense for every string in the suite.
    /// </summary>
    public static class PlaywrightTraceExtensions
    {
        public static Task<string?> UploadPlaywrightTraceAsync(string tracerPath)
        {
            // No-op default. Replace with real upload logic when ready.
            return Task.FromResult<string?>(null);
        }
    }
}
