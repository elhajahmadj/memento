using System.Collections.Generic;
using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests.Visual
{
    /// <summary>
    /// Visual regression smoke layer. The first run for any
    /// (role, route) tuple writes a baseline PNG and passes with a
    /// "baseline created" message; later runs diff against the baseline
    /// via <see cref="VisualBaseline"/> and fail when the per-test
    /// threshold is exceeded — at which point the actual + diff PNGs are
    /// attached to the NUnit test result for review.
    ///
    /// Set <c>MEMENTO_SKIP_VISUAL=1</c> to skip the suite cleanly during
    /// dev loops (the cases are reported as Skipped, not Failed).
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryVisual)]
    public sealed class VisualRegressionTests : AdminFixture
    {
        [OneTimeSetUp]
        public void SkipWhenOptedOut() => VisualGuard.SkipIfDisabled();

        // Mirrors the perf route set so a regression on any user-facing
        // page is caught visually too. /workbench is included because it
        // is the recorder's primary surface; its dynamic recording panel
        // is masked below.
        [TestCase("/", "home")]
        [TestCase("/workbench", "workbench")]
        [TestCase("/settings", "settings")]
        [TestCase("/tools", "tools")]
        [TestCase("/admin", "admin")]
        [TestCase("/tools/validation-traces", "tools_validation-traces")]
        [TestCase("/tools/test-runs", "tools_test-runs")]
        [TestCase("/my-approvals", "my-approvals")]
        [TestCase("/documentation", "documentation")]
        [TestCase("/about", "about")]
        public async Task Capture_full_page_screenshot(string path, string slug)
        {
            await VisualProbe.RunAsync(
                Page,
                role: "admin",
                route: path,
                slug: slug,
                threshold: MementoSettings.VisualThreshold,
                masks: VisualMasks.For(path));
        }
    }

    /// <summary>
    /// Login is the only unauthenticated surface in the visual suite;
    /// it lives in its own fixture so it doesn't pull a storage state.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryVisual)]
    public sealed class LoginVisualRegressionTests : TestFixture
    {
        [OneTimeSetUp]
        public void SkipWhenOptedOut() => VisualGuard.SkipIfDisabled();

        [Test]
        public async Task Login_full_page_screenshot()
        {
            await Page.GotoAsync(MementoSettings.BaseUrl + "/login");
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            await VisualProbe.RunAsync(
                Page,
                role: "anonymous",
                route: "/login",
                slug: "login",
                threshold: MementoSettings.VisualThreshold,
                masks: VisualMasks.For("/login"));
        }
    }

    /// <summary>
    /// Per-role coverage of the home page so role-scoped UI regressions
    /// (a missing tile for User, a different banner for Limited Admin)
    /// surface here too.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryVisual)]
    public sealed class UserHomeVisualRegressionTests : UserFixture
    {
        [OneTimeSetUp]
        public void SkipWhenOptedOut() => VisualGuard.SkipIfDisabled();

        [Test]
        public async Task Home_full_page_screenshot()
        {
            await VisualProbe.RunAsync(
                Page, role: "user", route: "/", slug: "home",
                threshold: MementoSettings.VisualThreshold,
                masks: VisualMasks.For("/"));
        }
    }

    /// <summary>Honors <c>MEMENTO_SKIP_VISUAL=1</c> uniformly across visual fixtures.</summary>
    internal static class VisualGuard
    {
        public static void SkipIfDisabled()
        {
            if (MementoSettings.SkipVisual)
            {
                Assert.Ignore("Visual suite skipped via MEMENTO_SKIP_VISUAL.");
            }
        }
    }

    /// <summary>
    /// Per-route CSS-selector masks for known-dynamic regions. Each entry
    /// is a list of selectors that will be blacked out before the
    /// screenshot is taken — keep them tight so we don't mask away the
    /// regression we're trying to catch.
    /// </summary>
    internal static class VisualMasks
    {
        private static readonly IReadOnlyDictionary<string, string[]> _masks =
            new Dictionary<string, string[]>
            {
                // The home page surfaces "last updated" timestamps on
                // project tiles.
                ["/"] = new[] { "[data-testid='timestamp']", "[data-testid='last-updated']" },
                // Validation traces show file sizes / mtimes that change
                // on every disk scan.
                ["/tools/validation-traces"] = new[]
                {
                    "[data-testid='timestamp']",
                    "[data-testid='trace-mtime']",
                    "[data-testid='trace-size']",
                },
                // Test runs dashboard renders sparklines and "ran X
                // minutes ago" labels — both are inherently dynamic.
                ["/tools/test-runs"] = new[]
                {
                    "[data-testid='timestamp']",
                    "[data-testid='sparkline']",
                    "[data-testid='run-relative-time']",
                },
                // My-approvals lists submission times.
                ["/my-approvals"] = new[] { "[data-testid='timestamp']" },
                // Workbench shows the live recorder panel and a recent-
                // recordings list with timestamps.
                ["/workbench"] = new[]
                {
                    "[data-testid='timestamp']",
                    "[data-testid='recorder-panel']",
                },
                // About shows a build/version line that bumps each deploy.
                ["/about"] = new[] { "[data-testid='build-version']" },
            };

        public static string[] For(string route) =>
            _masks.TryGetValue(route, out var masks) ? masks : System.Array.Empty<string>();
    }

    /// <summary>Tiny shared helper so every visual case asserts the same way.</summary>
    internal static class VisualProbe
    {
        public static async Task RunAsync(
            IPage page,
            string role,
            string route,
            string slug,
            double threshold,
            string[] masks)
        {
            await page.GotoAsync(MementoSettings.BaseUrl + route);
            await page.WaitForLoadStateAsync(LoadState.NetworkIdle);

            var result = await VisualBaseline.CaptureAndCompareAsync(
                page, role, slug, threshold, masks);

            TestContext.WriteLine(result.Message);

            switch (result.Outcome)
            {
                case VisualOutcome.BaselineCreated:
                case VisualOutcome.Match:
                    result.DiffRatio.Should().BeLessThanOrEqualTo(threshold);
                    return;
                case VisualOutcome.Mismatch:
                    Assert.Fail(result.Message);
                    return;
            }
        }
    }
}
