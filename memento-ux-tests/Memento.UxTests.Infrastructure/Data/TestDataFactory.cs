using System;
using System.Threading;

namespace Memento.UxTests.Infrastructure.Data
{
    /// <summary>
    /// Per-run unique identifiers so parallel suites don't collide on
    /// project / fork / recording / mock names. The run id is computed
    /// once per process and reused across every name the suite mints.
    /// </summary>
    public static class TestDataFactory
    {
        public static string RunId { get; } =
            DateTime.UtcNow.ToString("yyyyMMddHHmmss")
            + "-"
            + Guid.NewGuid().ToString("N").Substring(0, 6);

        private static int _counter;

        public static string ProjectName(string suffix = "") =>
            $"UxRun{RunId}{(string.IsNullOrEmpty(suffix) ? string.Empty : suffix)}".Replace("-", "");

        public static string RecordingName(string suffix = "") =>
            $"Rec{NextSeq()}{suffix}";

        public static string MockName(string suffix = "") =>
            $"Mock{NextSeq()}{suffix}";

        public static string ForkProjectKey() => $"fork-{NextSeq()}";

        private static int NextSeq() => Interlocked.Increment(ref _counter);
    }
}
