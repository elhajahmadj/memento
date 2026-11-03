using System;
using System.Diagnostics;
using System.Threading.Tasks;
using Memento.UxTests.Infrastructure.Interfaces;
using Memento.UxTests.Infrastructure.Services;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Shared.Helpers;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Infrastructure.Fixtures
{
    /// <summary>
    /// Per-test fixture wired with DI, browser lifecycle, screenshots on
    /// failure and Playwright tracing. Page-object based test suites
    /// inherit from this class.
    ///
    /// The DI container is built once per process via <see cref="Lazy{T}"/>
    /// (see <see cref="BuildServiceProvider"/>) and released at process
    /// exit. ProcessExit (rather than any single fixture's
    /// <c>[OneTimeTearDown]</c>) is the only safe point at which "every
    /// fixture is done with the container" is guaranteed when fixtures
    /// run in parallel.
    /// </summary>
    public abstract class TestFixture : TestFixtureBase, IAsyncDisposable, IDisposable
    {
        protected TestContextHelper? _testContextHelper;
        protected TestOutputLogger _logger = new TestOutputLogger();

        private static readonly Lazy<ServiceProvider> _lazyServiceProvider =
            new Lazy<ServiceProvider>(BuildServiceProvider);

        protected static IBrowserManager? _browserManager;

        protected TestFixture()
        {
        }

        /// <summary>Override to add per-fixture setup before each test.</summary>
        protected virtual Task OnTestFixtureSetupAsync() => Task.CompletedTask;

        /// <summary>Override to add per-fixture teardown before page disposal.</summary>
        protected virtual Task OnTestFixtureTearDownAsync() => Task.CompletedTask;

        /// <summary>
        /// Override to inject context options (storage state, viewport,
        /// locale, ...). Default returns an empty options object so the
        /// fixture launches a clean session every test.
        /// </summary>
        protected virtual BrowserNewContextOptions BuildContextOptions() =>
            new BrowserNewContextOptions();

        [OneTimeSetUp]
        public void GlobalSetup()
        {
            // Touch the lazy so the container is built up-front for the
            // first fixture in the run.
            _ = _lazyServiceProvider.Value;
        }

        [SetUp, Order(0)]
        public async Task SetUpAsync()
        {
            // Resolved transient on purpose — each test gets its own
            // browser/context/page lifecycle.
            _browserManager = _lazyServiceProvider.Value.GetRequiredService<IBrowserManager>();

            _testContextHelper = new TestContextHelper(TestContext.CurrentContext);
            _testContextHelper.RunTestByName(MementoSettings.TestName);

            await _browserManager.LaunchBrowserAsync(BuildContextOptions());
            ResolveBrowserObjects();

            if (TestCategory == Constants.STARTTRACER
                || MementoSettings.RunTracer
                || MementoSettings.StartTracer)
            {
                await _browserManager.StartTracingAsync();
            }

            await OnTestFixtureSetupAsync();
        }

        [TearDown, Order(0)]
        public async Task TearDownAsync()
        {
            bool uploadTracer = !Configuration.IsLocalEnv();

            await OnTestFixtureTearDownAsync();

            if (_testContextHelper != null
                && _browserManager != null
                && _testContextHelper.HasTestFailed()
                && page != null)
            {
                _logger.LogTestFailedData(_testContextHelper);
                Console.WriteLine($"Test failed at URL: {page.Url}");
                await _browserManager.TakeScreenshotAsync(page, _logger);
            }

            TestTracker.CountPassingTests();
            TestTracker.CountSkippedTests();

            if (_browserManager != null
                && page != null
                && TestContext.CurrentContext.Result.Outcome.Status
                    != NUnit.Framework.Interfaces.TestStatus.Skipped
                && _browserManager.TracingStarted)
            {
                await _browserManager.StopTracingAsync(page, uploadTracer, _logger);
            }

            await DisposeAsync();
        }

        private void ResolveBrowserObjects()
        {
            var bm = _browserManager!;
            SetBrowserObjects(
                playwright: bm.playwright,
                browser: bm.Browser,
                context: bm.Context,
                page: bm.page);
        }

        public void Dispose()
        {
            Trace.TraceInformation($"{nameof(TestFixture)}::Dispose()");
            GC.SuppressFinalize(this);
        }

        public async ValueTask DisposeAsync()
        {
            await DisposePlaywrightAsync();
        }

        private async Task DisposePlaywrightAsync()
        {
            if (_browserManager == null) return;

            await SafeDisposeAsync(_browserManager.Context, "browser context");
            await SafeDisposeAsync(_browserManager.Browser, "browser");
            await SafeClosePageAsync(_browserManager.page, "page");

            SafeDispose(_browserManager.playwright, "Playwright");
            SafeDispose(playwright, "Playwright (base)");
        }

        private static ServiceProvider BuildServiceProvider()
        {
            var services = new ServiceCollection();
            services.AddSingleton<IConfiguration>(Configuration);
            services.AddSingleton<IConfigurationRoot>(Configuration);
            services.AddTransient<IBrowserManager, BrowserManager>();
            var provider = services.BuildServiceProvider();

            AppDomain.CurrentDomain.ProcessExit += (_, _) =>
            {
                try { provider.Dispose(); }
                catch { /* best-effort during shutdown */ }
            };

            return provider;
        }

        private static async Task SafeDisposeAsync(IAsyncDisposable? disposable, string name)
        {
            if (disposable == null) return;
            try { await disposable.DisposeAsync(); }
            catch (Exception ex) { Console.WriteLine($"Error disposing {name}: {ex.Message}"); }
        }

        private static async Task SafeClosePageAsync(IPage? page, string name)
        {
            if (page == null) return;
            try { await page.CloseAsync(); }
            catch (Exception ex) { Console.WriteLine($"Error closing {name}: {ex.Message}"); }
        }

        private static void SafeDispose(IDisposable? disposable, string name)
        {
            if (disposable == null) return;
            try { disposable.Dispose(); }
            catch (Exception ex) { Console.WriteLine($"Error disposing {name}: {ex.Message}"); }
        }
    }
}
