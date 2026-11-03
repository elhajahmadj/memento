using System;
using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Memento.UxTests.Tests.PageObjects.Selectors;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// Top-nav logo + Back button parity across every top-level admin
    /// route per REQUIREMENTS.md line 31-32. Logo always returns to
    /// home, and Settings / Tools / Validation Traces all expose a
    /// Back button via the shared <c>PageShell</c>.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class LogoReturnsToHomeFromEveryRouteTests : AdminFixture
    {
        // Every admin-visible top-level route from RouteAccess.Matrix
        // that is NOT itself the home page. Routes that redirect (login,
        // splash, profile/complete) are excluded — there's no logo to
        // click on those screens.
        [TestCase("/settings")]
        [TestCase("/tools")]
        [TestCase("/admin")]
        [TestCase("/tools/validation-traces")]
        [TestCase("/tools/internal-tests")]
        [TestCase("/tools/test-runs")]
        [TestCase("/documentation")]
        [TestCase("/about")]
        [TestCase("/profile")]
        public async Task Logo_returns_to_home_from(string route)
        {
            await Page.GotoAsync(MementoSettings.BaseUrl + route);
            await Page.WaitForLoadStateAsync(Microsoft.Playwright.LoadState.NetworkIdle);

            var logo = Page.GetByTestId(TopNavSelectors.LogoMemento);
            (await logo.IsVisibleAsync()).Should().BeTrue(
                $"the top-nav logo must render on {route}");

            await logo.ClickAsync();
            await Page.WaitForURLAsync(url =>
            {
                var p = new Uri(url).AbsolutePath.TrimEnd('/');
                return p.Length == 0 || p == "/";
            }, new() { Timeout = 5000 });
            new Uri(Page.Url).AbsolutePath.TrimEnd('/').Should().BeOneOf(string.Empty, "/",
                $"the logo on {route} should land on home");
        }
    }

    /// <summary>
    /// Back-button parity: Settings, Tools landing, and the
    /// Validation Traces deep-link all expose a Back button per the
    /// shared PageShell contract. Selectors come from the
    /// <c>backTestId</c> prop on each page's PageShell.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class PageShellBackButtonParityTests : AdminFixture
    {
        [TestCase("/settings",                "button-settings-back")]
        [TestCase("/tools",                   "button-tools-back")]
        [TestCase("/tools/validation-traces", "button-validation-traces-back")]
        public async Task Back_button_renders_on(string route, string backTestId)
        {
            await Page.GotoAsync(MementoSettings.BaseUrl + route);
            await Page.WaitForLoadStateAsync(Microsoft.Playwright.LoadState.NetworkIdle);
            (await Page.GetByTestId(backTestId).IsVisibleAsync()).Should().BeTrue(
                $"{route} must render a Back button (data-testid={backTestId})");
        }

        [Test]
        public async Task Settings_back_button_navigates_home()
        {
            await Page.GotoAsync(MementoSettings.BaseUrl + "/settings");
            await Page.GetByTestId("button-settings-back").ClickAsync();
            await Page.WaitForURLAsync(url => !url.Contains("/settings"));
            new Uri(Page.Url).AbsolutePath.TrimEnd('/').Should().BeOneOf(string.Empty, "/");
        }

        [Test]
        public async Task Validation_traces_back_button_navigates_to_tools()
        {
            await Page.GotoAsync(MementoSettings.BaseUrl + "/tools/validation-traces");
            await Page.GetByTestId("button-validation-traces-back").ClickAsync();
            await Page.WaitForURLAsync(url => !url.Contains("validation-traces"));
            new Uri(Page.Url).AbsolutePath.Should().Be("/tools");
        }
    }
}
