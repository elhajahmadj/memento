using System.Diagnostics;
using FluentAssertions;
using FluentAssertions.Extensions;
using Memento.UxTests.Shared.Configuration;
using Microsoft.Extensions.Configuration;
using Microsoft.Playwright;

namespace Memento.UxTests.Infrastructure.Fixtures
{
    /// <summary>
    /// Lowest layer of the Playwright + NUnit fixture chain. Holds the
    /// shared Playwright handles plus the strongly-typed configuration
    /// surface every concrete fixture needs. Concrete behavior (browser
    /// launch, screenshots-on-failure, tracing) lives in
    /// <see cref="TestFixture"/>.
    ///
    /// Mirrors memento's own <c>TestFixtureBase</c> on purpose so this
    /// suite is structurally identical to a freshly-recorded memento
    /// project.
    /// </summary>
    public abstract class TestFixtureBase
    {
        public IPlaywright? playwright { get; private set; }
        public IBrowser? browser { get; private set; }
        public IBrowserContext? context { get; private set; }
        public IPage? page { get; private set; }

        /// <summary>PascalCase accessor for the current page.</summary>
        protected IPage Page => page!;

        /// <summary>
        /// Fixture-only entry point used by
        /// <see cref="TestFixture.ResolveBrowserObjects"/> after the
        /// browser manager (re)launches. Not intended for user code.
        /// </summary>
        protected void SetBrowserObjects(
            IPlaywright? playwright,
            IBrowser? browser,
            IBrowserContext? context,
            IPage? page)
        {
            this.playwright = playwright;
            this.browser = browser;
            this.context = context;
            this.page = page;
        }

        public static IConfigurationRoot Configuration { get; }

        public string TestCategory { get; set; } = string.Empty;

        static TestFixtureBase()
        {
            Configuration = AppConfigurationExtensions.GetConfiguration();
            // Mirror appsettings.json onto the strongly-typed
            // MementoSettings surface once per process so fixtures and
            // page objects can read settings without re-parsing strings.
            Configuration.LoadMementoSettings();
            Trace.TraceInformation($"{nameof(TestFixtureBase)}::ctor()");

            AssertionOptions.AssertEquivalencyUsing(options =>
            {
                options.ExcludingMissingMembers();
                options.Using<DateTimeOffset>(ctx =>
                    ctx.Subject.Should().BeCloseTo(ctx.Expectation, 1.Seconds())
                ).WhenTypeIs<DateTimeOffset>();
                return options;
            });
        }
    }
}
