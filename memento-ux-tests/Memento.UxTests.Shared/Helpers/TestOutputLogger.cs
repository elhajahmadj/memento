using System;
using NUnit.Framework;

namespace Memento.UxTests.Shared.Helpers
{
    /// <summary>
    /// Thin wrapper around <see cref="TestContext.Progress"/> so test code
    /// has one consistent place to write progress / failure information.
    /// Routing through <c>TestContext.Progress</c> keeps the output tied
    /// to the running test even under parallel NUnit execution.
    /// </summary>
    public class TestOutputLogger
    {
        public void Info(string message)
        {
            TestContext.Progress.WriteLine($"[INFO ] {DateTime.UtcNow:O} :: {message}");
        }

        public void Warn(string message)
        {
            TestContext.Progress.WriteLine($"[WARN ] {DateTime.UtcNow:O} :: {message}");
        }

        public void Error(string message)
        {
            TestContext.Progress.WriteLine($"[ERROR] {DateTime.UtcNow:O} :: {message}");
        }

        public void LogTestFailedData(TestContextHelper helper)
        {
            TestContext.Progress.WriteLine(
                $"[FAIL ] {helper.TestName} :: {helper.FailureMessage}");
        }
    }
}
