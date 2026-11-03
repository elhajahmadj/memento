using System;
using NUnit.Framework;
using NUnit.Framework.Internal;

namespace Memento.UxTests.Shared.Helpers
{
    /// <summary>
    /// Captures the bits of <see cref="TestContext"/> the fixture needs to
    /// take screenshots, save traces, and log failures. Built fresh per
    /// test in the fixture's <c>SetUpAsync</c>.
    /// </summary>
    public class TestContextHelper
    {
        private readonly TestContext _context;

        public TestContextHelper(TestContext context)
        {
            _context = context ?? throw new ArgumentNullException(nameof(context));
            TestName = context.Test.Name;
            FullName = context.Test.FullName;
        }

        public string TestName { get; }
        public string FullName { get; }

        public string FailureMessage =>
            _context.Result?.Message ?? string.Empty;

        public bool HasTestFailed()
        {
            var status = _context.Result?.Outcome.Status;
            return status == NUnit.Framework.Interfaces.TestStatus.Failed
                || status == NUnit.Framework.Interfaces.TestStatus.Inconclusive;
        }

        /// <summary>
        /// Optional filter — when <c>MementoSettings.TestName</c> is set
        /// we skip every test except the one whose name matches.
        /// </summary>
        public void RunTestByName(string filter)
        {
            if (string.IsNullOrWhiteSpace(filter)) return;
            if (!string.Equals(filter, TestName, StringComparison.OrdinalIgnoreCase))
            {
                Assert.Ignore($"Skipping '{TestName}' — only '{filter}' is selected.");
            }
        }
    }
}
