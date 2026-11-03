using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Playwright;
using NUnit.Framework;
using {Namespace}.Services;

namespace {Namespace}.Base
{
    /// <summary>
    /// Base fixture for all Playwright + NUnit tests.
    /// Provides per-test browser, context and page lifecycle plus DI.
    /// </summary>
    public abstract class TestFixture
    {
        protected IServiceProvider Services { get; private set; } = null!;
        protected IConfiguration Configuration { get; private set; } = null!;
        protected IBrowserService BrowserService { get; private set; } = null!;
        protected IBrowser Browser { get; private set; } = null!;
        protected IBrowserContext Context { get; private set; } = null!;
        protected IPage Page { get; private set; } = null!;

        [OneTimeSetUp]
        public async Task OneTimeSetUpAsync()
        {
            Configuration = new ConfigurationBuilder()
                .SetBasePath(TestContext.CurrentContext.TestDirectory)
                .AddJsonFile("appsettings.json", optional: true)
                .Build();

            var services = new ServiceCollection();
            services.AddSingleton<IConfiguration>(Configuration);
            services.AddSingleton<IBrowserService, BrowserService>();
            Services = services.BuildServiceProvider();

            BrowserService = Services.GetRequiredService<IBrowserService>();
            Browser = await BrowserService.LaunchAsync();
        }

        [SetUp]
        public async Task SetUpAsync()
        {
            Context = await Browser.NewContextAsync();
            Page = await Context.NewPageAsync();
        }

        [TearDown]
        public async Task TearDownAsync()
        {
            if (Context != null) await Context.CloseAsync();
        }

        [OneTimeTearDown]
        public async Task OneTimeTearDownAsync()
        {
            if (Browser != null) await Browser.CloseAsync();
            await BrowserService.DisposeAsync();
        }
    }
}
