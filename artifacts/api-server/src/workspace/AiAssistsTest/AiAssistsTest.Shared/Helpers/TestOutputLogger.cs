using System;
using NUnit.Framework;

namespace AiAssistsTest.QA.Shared.Helpers
{
    /// <summary>
    /// Writes test diagnostic output via <see cref="TestContext.Progress"/> so it
    /// streams live to dotnet test, Visual Studio Test Explorer, and Rider —
    /// raw <c>Console</c> output is not reliably captured across all NUnit
    /// adapters. Replace the implementation to forward to a structured logger
    /// or test reporter without touching the fixture call sites.
    /// </summary>
    public class TestOutputLogger
    {
        public void LogTestFailedData(TestContextHelper context)
        {
            TestContext.Progress.WriteLine("==========================================");
            TestContext.Progress.WriteLine($"TEST FAILED: {context.FullName}");
            TestContext.Progress.WriteLine($"Message    : {context.Message}");
            TestContext.Progress.WriteLine($"StackTrace : {context.StackTrace}");
            TestContext.Progress.WriteLine("==========================================");
        }

        public void LogScreenShotData(string screenshotPath)
        {
            TestContext.Progress.WriteLine($"Screenshot saved to: {screenshotPath}");
        }

        public void LogTracerData(string tracerPath, string playwrightPs1Path)
        {
            TestContext.Progress.WriteLine($"Playwright trace saved to: {tracerPath}");
            TestContext.Progress.WriteLine($"View locally with: pwsh {playwrightPs1Path} show-trace {tracerPath}");
        }

        public void LogInfo(string message)
        {
            TestContext.Progress.WriteLine($"[INFO] {message}");
        }

        public void LogWarning(string message)
        {
            TestContext.Progress.WriteLine($"[WARN] {message}");
        }

        public void LogError(string message, Exception? ex = null)
        {
            TestContext.Progress.WriteLine($"[ERROR] {message}");
            if (ex != null) TestContext.Progress.WriteLine(ex.ToString());
        }
    }
}
