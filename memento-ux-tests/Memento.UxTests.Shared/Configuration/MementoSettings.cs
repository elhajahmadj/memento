using System.Collections.Generic;

namespace Memento.UxTests.Shared.Configuration
{
    /// <summary>
    /// Strongly-typed view over <c>appsettings.json</c> + environment
    /// variables. Hydrated once per process by
    /// <see cref="AppConfigurationExtensions.LoadMementoSettings"/>.
    ///
    /// Mirrors the shape of memento's own <c>TestConfig</c> in spirit
    /// (static read-once surface) but adds the role credentials and the
    /// memento BaseUrl that this UX suite needs to drive the live app.
    /// </summary>
    public static class MementoSettings
    {
        // ---- Browser / Playwright ----
        public static string DefaultBrowser { get; set; } = "chromium";
        public static bool UseChromium { get; set; } = true;
        public static bool RunHeadless { get; set; } = true;
        public static int PlaywrightTimeout { get; set; } = 30000;
        public static bool StartTracer { get; set; } = false;

        // ---- Memento target ----
        /// <summary>Base URL of the running memento app, e.g. http://localhost:80 .</summary>
        public static string BaseUrl { get; set; } = "http://localhost:80";

        /// <summary>Active environment label (Local, Dev, QA, Prod, ...).</summary>
        public static string Environment { get; set; } = "Local";

        // ---- Seeded role credentials ----
        public static RoleCredentials MementoAdminCredentials { get; set; } =
            new RoleCredentials(Constants.MementoAdminUsername, Constants.SeedPassword);

        public static RoleCredentials AdminCredentials { get; set; } =
            new RoleCredentials(Constants.AdminUsername, Constants.SeedPassword);

        public static RoleCredentials LimitedAdminCredentials { get; set; } =
            new RoleCredentials(Constants.LimitedAdminUsername, Constants.SeedPassword);

        public static RoleCredentials UserCredentials { get; set; } =
            new RoleCredentials(Constants.UserUsername, Constants.SeedPassword);

        // ---- Run-wide switches ----
        /// <summary>When set, only the matching test method will run; others are skipped.</summary>
        public static string TestName { get; set; } = string.Empty;

        /// <summary>Force-enable Playwright tracing for every test in the run.</summary>
        public static bool RunTracer { get; set; } = false;

        /// <summary>Named application URLs that page objects can resolve.</summary>
        public static Dictionary<string, string> Urls { get; set; } =
            new Dictionary<string, string>();

        // ---- Performance smoke ----
        /// <summary>
        /// Default wall-clock budget (in milliseconds) for an authenticated
        /// page to reach an interactive state. Used by the
        /// <c>Performance</c> suite. Override via <c>PerformanceBudgetMs</c>
        /// in <c>appsettings.local.json</c> or the
        /// <c>MEMENTO_UX_PERFORMANCEBUDGETMS</c> env var.
        /// </summary>
        public static int PerformanceBudgetMs { get; set; } = 5000;

        /// <summary>
        /// Wall-clock budget for unauthenticated entry pages
        /// (<c>/login</c>, <c>/splash</c>) — usually a touch tighter than
        /// the authenticated budget because there is no session bootstrap.
        /// </summary>
        public static int UnauthenticatedPerformanceBudgetMs { get; set; } = 4000;

        /// <summary>
        /// Largest Contentful Paint budget (ms) for authenticated pages.
        /// Defaults to the Web Vitals "good" threshold (2500 ms). Override
        /// via <c>LargestContentfulPaintBudgetMs</c> in appsettings or the
        /// <c>MEMENTO_UX_LARGESTCONTENTFULPAINTBUDGETMS</c> env var.
        /// </summary>
        public static int LargestContentfulPaintBudgetMs { get; set; } = 2500;

        /// <summary>
        /// LCP budget (ms) for unauthenticated entry pages.
        /// </summary>
        public static int UnauthenticatedLargestContentfulPaintBudgetMs { get; set; } = 2000;

        /// <summary>
        /// Cumulative Layout Shift budget (unitless). Defaults to the Web
        /// Vitals "good" threshold (0.1). Applied to every perf route,
        /// authenticated or not.
        /// </summary>
        public static double CumulativeLayoutShiftBudget { get; set; } = 0.1;

        /// <summary>
        /// Time-to-Interactive proxy budget (ms) for authenticated pages.
        /// Implemented as PerformanceNavigationTiming.domInteractive — the
        /// moment the parser finishes and event handlers can attach. Not a
        /// full Web Vitals TTI (which requires long-task tracking) but a
        /// reliable, library-free proxy that catches the same regressions.
        /// </summary>
        public static int TimeToInteractiveBudgetMs { get; set; } = 3500;

        /// <summary>
        /// TTI proxy budget (ms) for unauthenticated entry pages.
        /// </summary>
        public static int UnauthenticatedTimeToInteractiveBudgetMs { get; set; } = 3000;

        /// <summary>Bundle of every per-route budget for authenticated pages.</summary>
        public static PerformanceBudgets AuthenticatedBudgets => new PerformanceBudgets(
            WallClockMs: PerformanceBudgetMs,
            LargestContentfulPaintMs: LargestContentfulPaintBudgetMs,
            CumulativeLayoutShift: CumulativeLayoutShiftBudget,
            TimeToInteractiveMs: TimeToInteractiveBudgetMs);

        /// <summary>Bundle of every per-route budget for unauthenticated entry pages.</summary>
        public static PerformanceBudgets UnauthenticatedBudgets => new PerformanceBudgets(
            WallClockMs: UnauthenticatedPerformanceBudgetMs,
            LargestContentfulPaintMs: UnauthenticatedLargestContentfulPaintBudgetMs,
            CumulativeLayoutShift: CumulativeLayoutShiftBudget,
            TimeToInteractiveMs: UnauthenticatedTimeToInteractiveBudgetMs);

        // ---- Visual regression ----
        /// <summary>
        /// Allowed fraction of differing pixels (0.0–1.0) before a visual
        /// regression test fails. Default is 2%.
        /// </summary>
        public static double VisualThreshold { get; set; } = 0.02;

        /// <summary>
        /// When true, the Visual category is skipped (not failed) so dev
        /// loops can opt out. Sourced from the <c>MEMENTO_SKIP_VISUAL</c>
        /// env var (any non-empty / non-"0" value) or the
        /// <c>SkipVisual</c> appsettings key.
        /// </summary>
        public static bool SkipVisual { get; set; } = false;
    }

    /// <summary>Username + password tuple for one of the three seeded roles.</summary>
    public sealed record RoleCredentials(string Username, string Password);

    /// <summary>
    /// Bundle of per-route performance budgets used by the
    /// <c>PerformanceSmokeTests</c>. Wall-clock is the legacy NetworkIdle
    /// timer; LCP / CLS / TTI come from the Web Vitals family captured via
    /// <c>PerformanceObserver</c> in the page under test.
    /// </summary>
    public sealed record PerformanceBudgets(
        int WallClockMs,
        int LargestContentfulPaintMs,
        double CumulativeLayoutShift,
        int TimeToInteractiveMs);
}
