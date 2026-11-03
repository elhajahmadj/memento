using System.Threading;
using NUnit.Framework;

namespace Memento.UxTests.Shared.Helpers
{
    /// <summary>
    /// Process-wide counters so a CI run can summarize totals at the
    /// bottom of its log without parsing the .trx report.
    /// </summary>
    public static class TestTracker
    {
        private static int _passed;
        private static int _skipped;

        public static int Passed => _passed;
        public static int Skipped => _skipped;

        public static void CountPassingTests()
        {
            if (TestContext.CurrentContext.Result.Outcome.Status
                == NUnit.Framework.Interfaces.TestStatus.Passed)
            {
                Interlocked.Increment(ref _passed);
            }
        }

        public static void CountSkippedTests()
        {
            if (TestContext.CurrentContext.Result.Outcome.Status
                == NUnit.Framework.Interfaces.TestStatus.Skipped)
            {
                Interlocked.Increment(ref _skipped);
            }
        }
    }
}
