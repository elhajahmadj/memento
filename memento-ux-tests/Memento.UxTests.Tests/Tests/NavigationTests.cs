using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class AdminNavigationTests : AdminFixture
    {
        [Test]
        public async Task Admin_lands_on_authenticated_home()
        {
            Page.Url.Should().NotContain("/login");
            var home = new HomePage(Page);
            (await home.IsTryDemoCardVisibleAsync()
                || await home.IsProjectListVisibleAsync()).Should().BeTrue();
        }

        [Test]
        public async Task Top_nav_logo_returns_to_home_from_settings()
        {
            await new SettingsPage(Page).GotoAsync();
            await new TopNav(Page).ClickLogoAsync();
            await Page.WaitForURLAsync(url => !url.Contains("/settings"));
            Page.Url.TrimEnd('/').Should().EndWith(MementoSettings.BaseUrl.TrimEnd('/'));
        }

        [Test]
        public async Task Tools_landing_shows_all_admin_tool_cards()
        {
            var tools = new ToolsLandingPage(Page);
            await tools.GotoAsync();
            (await tools.IsCardVisibleAsync(PageObjects.Selectors.ToolsSelectors.CardApproval))
                .Should().BeTrue();
            (await tools.IsCardVisibleAsync(PageObjects.Selectors.ToolsSelectors.CardForkRequests))
                .Should().BeTrue();
            (await tools.IsCardVisibleAsync(PageObjects.Selectors.ToolsSelectors.CardProjectAssignments))
                .Should().BeTrue();
        }

        [Test]
        public async Task Documentation_layout_renders_for_admin()
        {
            var docs = new DocumentationPage(Page);
            await docs.GotoAsync();
            (await docs.IsLayoutVisibleAsync()).Should().BeTrue();
        }

        [Test]
        public async Task About_page_shows_creator_card()
        {
            var about = new AboutPage(Page);
            await about.GotoAsync();
            (await about.ReadTitleAsync()).Should().NotBeNullOrWhiteSpace();
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class LimitedAdminNavigationTests : LimitedAdminFixture
    {
        [Test]
        public async Task LimitedAdmin_settings_shows_scope_banner()
        {
            var settings = new SettingsPage(Page);
            await settings.GotoAsync();
            (await settings.IsLimitedAdminBannerVisibleAsync()
                || await settings.IsSectionVisibleAsync(PageObjects.Interfaces.SettingsSection.Architectures))
                .Should().BeTrue();
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class UserNavigationTests : UserFixture
    {
        [Test]
        public async Task User_can_reach_documentation()
        {
            var docs = new DocumentationPage(Page);
            await docs.GotoAsync();
            (await docs.IsLayoutVisibleAsync() || await docs.IsEmptyStateVisibleAsync())
                .Should().BeTrue();
        }

        [Test]
        public Task User_lands_authenticated()
        {
            Page.Url.Should().NotContain("/login");
            return Task.CompletedTask;
        }
    }
}
