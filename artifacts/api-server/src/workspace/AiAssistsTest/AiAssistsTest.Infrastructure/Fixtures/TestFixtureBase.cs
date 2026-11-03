using System.Diagnostics;
using Bogus;
using FluentAssertions;
using FluentAssertions.Extensions;
using Microsoft.Extensions.Configuration;
using Microsoft.Playwright;
using NUnit.Framework;
using AiAssistsTest.QA.Shared.Configuration;

namespace AiAssistsTest.QA.Infrastructure.Fixtures
{
    /// <summary>
    /// Lowest layer of the Playwright + NUnit fixture chain. Holds shared state
    /// (Playwright objects, configuration, faker) that every concrete fixture needs.
    /// Concrete behaviour lives in <see cref="TestFixture"/>.
    /// </summary>
    public abstract class TestFixtureBase
    {
        // The four Playwright state holders are exposed as read-only-from-
        // outside properties (private setters) so test code can't accidentally
        // reassign them and break TestFixture's lifecycle assumptions. The
        // fixture lifecycle refreshes them through SetBrowserObjects below.
        public IPlaywright? playwright { get; private set; }
        public IBrowser? browser { get; private set; }
        public IBrowserContext? context { get; private set; }
        public IPage? page { get; private set; }

        /// <summary>
        /// PascalCase accessor for the current <see cref="IPage"/>. Recorded
        /// test code emits <c>Page</c> per .NET property naming conventions;
        /// this property bridges to the lowercase <c>page</c> property that
        /// the fixture lifecycle manages.
        /// </summary>
        protected IPage Page => page!;

        /// <summary>
        /// Fixture-only entry point used by <c>TestFixture.ResolveBrowserObjects</c>
        /// to refresh the four Playwright state holders after the browser
        /// manager (re)launches a browser. Not intended for user test code.
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

        public readonly Faker faker = new Faker();

        public static IConfigurationRoot Configuration { get; }

        public string TestCategory { get; set; } = string.Empty;
        public string FixtureTestCategory { get; set; } = string.Empty;
        public string TestSuiteFilePath { get; set; } = string.Empty;

        static TestFixtureBase()
        {
            Configuration = AppConfigurationExtensions.GetConfiguration();
            // Mirror appsettings.json onto the strongly-typed TestConfig surface
            // once per process so fixtures and page objects can read settings
            // through TestConfig.* without re-parsing strings on every test.
            Configuration.LoadTestConfig();
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
