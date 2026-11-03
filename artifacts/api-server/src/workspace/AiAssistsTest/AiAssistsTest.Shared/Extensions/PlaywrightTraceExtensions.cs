using System.Threading.Tasks;

namespace AiAssistsTest.QA.Shared.Extensions
{
    /// <summary>
    /// Hook for shipping a local trace zip to a remote viewer. Replace
    /// <see cref="UploadPlaywrightTraceAsync"/> with your own upload
    /// logic (Azure Blob, S3, etc.) and return the public URL the
    /// browser-trace viewer should be opened with.
    ///
    /// Intentionally a plain static helper rather than an extension
    /// method on <c>string</c>: extending <c>string</c> would attach
    /// <c>UploadPlaywrightTraceAsync</c> to every string in the
    /// scaffolded solution's IntelliSense, which is misleading API
    /// surface for what is really a single-purpose upload helper.
    ///
    /// The class name is preserved as <c>PlaywrightTraceExtensions</c>
    /// (rather than e.g. <c>PlaywrightTraceUploader</c>) to avoid
    /// breaking any forked architectures that already import this type
    /// by name; the namespace and filename stay in the
    /// <c>Shared/Extensions</c> folder for the same reason.
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
