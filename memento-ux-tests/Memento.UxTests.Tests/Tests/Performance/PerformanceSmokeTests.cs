using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests.Performance
{
    /// <summary>
    /// Lightweight perf smoke. Wall-clock-to-NetworkIdle is kept as the
    /// historical baseline, but every authenticated route also reports
    /// the Web Vitals trio — Largest Contentful Paint, Cumulative Layout
    /// Shift and a Time-to-Interactive proxy — so a regression a real
    /// user would feel (a 4 s LCP, a janky shift, a thread-blocked TTI)
    /// shows up here even when NetworkIdle stays flat. Per-metric budgets
    /// live alongside <see cref="MementoSettings.PerformanceBudgetMs"/>.
    ///
    /// The route list mirrors REQUIREMENTS.md "Top-level pages" so adding
    /// a new authenticated route is one <c>[TestCase]</c> away from
    /// covered.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryPerformance)]
    public sealed class PerformanceSmokeTests : AdminFixture
    {
        [TestCase("/")]
        [TestCase("/workbench")]
        [TestCase("/settings")]
        [TestCase("/tools")]
        [TestCase("/admin")]
        [TestCase("/tools/validation-traces")]
        [TestCase("/tools/test-runs")]
        [TestCase("/my-approvals")]
        [TestCase("/documentation")]
        [TestCase("/about")]
        public async Task Page_loads_under_budget(string path)
        {
            await PerformanceProbe.AssertWithinBudgetAsync(
                Page, path, MementoSettings.AuthenticatedBudgets);
        }
    }

    /// <summary>
    /// Repeats the home-page perf smoke for every seeded role so a
    /// role-scoped regression (e.g. an extra authorization round-trip
    /// for non-admins) surfaces here too.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryPerformance)]
    public sealed class LimitedAdminHomePerformanceTests : LimitedAdminFixture
    {
        [Test]
        public async Task Home_loads_under_budget()
        {
            await PerformanceProbe.AssertWithinBudgetAsync(
                Page, "/", MementoSettings.AuthenticatedBudgets);
        }
    }

    [TestFixture]
    [Category(Constants.CategoryPerformance)]
    public sealed class UserHomePerformanceTests : UserFixture
    {
        [Test]
        public async Task Home_loads_under_budget()
        {
            await PerformanceProbe.AssertWithinBudgetAsync(
                Page, "/", MementoSettings.AuthenticatedBudgets);
        }
    }

    /// <summary>
    /// Unauthenticated entry pages — covered without a role fixture so
    /// the storage state isn't applied. Splash auto-redirects to home a
    /// few seconds in; we assert it's interactive (not "fully idle")
    /// since the redirect itself is the point.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryPerformance)]
    public sealed class UnauthenticatedPerformanceTests : TestFixture
    {
        [Test]
        public async Task Login_loads_under_budget()
        {
            await PerformanceProbe.AssertWithinBudgetAsync(
                Page, "/login", MementoSettings.UnauthenticatedBudgets);
        }

        [Test]
        public async Task Splash_loads_under_budget()
        {
            // Splash is a transient screen — wait for DOMContentLoaded
            // (not NetworkIdle) so its background redirect doesn't get
            // counted as part of the budget. We keep this one wall-clock
            // only because LCP/CLS observers don't get a chance to settle
            // before the redirect tears the document down.
            var sw = Stopwatch.StartNew();
            await Page.GotoAsync(
                MementoSettings.BaseUrl + "/splash",
                new PageGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded });
            sw.Stop();

            sw.ElapsedMilliseconds.Should().BeLessThan(
                MementoSettings.UnauthenticatedPerformanceBudgetMs,
                "/splash should reach DOMContentLoaded within "
                + $"{MementoSettings.UnauthenticatedPerformanceBudgetMs}ms "
                + $"(got {sw.ElapsedMilliseconds}ms)");
        }
    }

    /// <summary>
    /// Captures wall-clock + Web Vitals (LCP/CLS/TTI) for a single page
    /// load and asserts each value against its dedicated budget. The
    /// observers are installed via <c>AddInitScriptAsync</c> so they run
    /// before any document script — including SPA bootstrap — and so
    /// every <c>largest-contentful-paint</c> and <c>layout-shift</c>
    /// entry from frame zero is counted.
    /// </summary>
    internal static class PerformanceProbe
    {
        // Buffered observers run library-free in the page; results land
        // on window.__perfMetrics for the .NET side to read after load.
        private const string PerfInitScript = @"
            (() => {
              if (window.__perfMetricsInstalled) return;
              window.__perfMetricsInstalled = true;
              window.__perfMetrics = { lcp: 0, cls: 0 };
              try {
                new PerformanceObserver((list) => {
                  const entries = list.getEntries();
                  const last = entries[entries.length - 1];
                  if (last) window.__perfMetrics.lcp = last.startTime;
                }).observe({ type: 'largest-contentful-paint', buffered: true });
              } catch (e) { /* unsupported — leave lcp at 0 */ }
              try {
                new PerformanceObserver((list) => {
                  for (const entry of list.getEntries()) {
                    if (!entry.hadRecentInput) {
                      window.__perfMetrics.cls += entry.value;
                    }
                  }
                }).observe({ type: 'layout-shift', buffered: true });
              } catch (e) { /* unsupported — leave cls at 0 */ }
            })();
        ";

        private const string PerfReadScript = @"
            () => {
              const m = window.__perfMetrics || { lcp: 0, cls: 0 };
              const nav = performance.getEntriesByType('navigation')[0];
              return {
                lcp: m.lcp || 0,
                cls: m.cls || 0,
                tti: nav ? nav.domInteractive : 0
              };
            }
        ";

        public static async Task AssertWithinBudgetAsync(
            IPage page, string path, PerformanceBudgets budgets)
        {
            await page.AddInitScriptAsync(PerfInitScript);

            var sw = Stopwatch.StartNew();
            await page.GotoAsync(MementoSettings.BaseUrl + path);
            // NetworkIdle is the historical baseline — keep it so the
            // wall-clock number stays comparable to past runs and so the
            // PerformanceObservers have a chance to flush before we read.
            await page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            sw.Stop();

            var raw = await page.EvaluateAsync<Dictionary<string, double>>(PerfReadScript);
            var lcp = raw.TryGetValue("lcp", out var l) ? l : 0d;
            var cls = raw.TryGetValue("cls", out var c) ? c : 0d;
            var tti = raw.TryGetValue("tti", out var t) ? t : 0d;
            var wall = sw.ElapsedMilliseconds;

            var failures = new List<string>();
            if (wall >= budgets.WallClockMs)
            {
                failures.Add(
                    $"WallClock={wall.ToString(CultureInfo.InvariantCulture)}ms "
                    + $"(budget {budgets.WallClockMs}ms)");
            }
            if (lcp >= budgets.LargestContentfulPaintMs)
            {
                failures.Add(
                    $"LCP={lcp.ToString("F0", CultureInfo.InvariantCulture)}ms "
                    + $"(budget {budgets.LargestContentfulPaintMs}ms)");
            }
            if (cls >= budgets.CumulativeLayoutShift)
            {
                failures.Add(
                    $"CLS={cls.ToString("F3", CultureInfo.InvariantCulture)} "
                    + $"(budget {budgets.CumulativeLayoutShift.ToString("F3", CultureInfo.InvariantCulture)})");
            }
            if (tti >= budgets.TimeToInteractiveMs)
            {
                failures.Add(
                    $"TTI={tti.ToString("F0", CultureInfo.InvariantCulture)}ms "
                    + $"(budget {budgets.TimeToInteractiveMs}ms)");
            }

            failures.Should().BeEmpty(
                $"path {path} should respect every performance budget — "
                + $"failed: {string.Join("; ", failures)}");
        }
    }
}
