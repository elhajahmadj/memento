using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class AdminSettingsTests : AdminFixture
    {
        protected override string StartPath => "/settings";

        // After the Settings/Admin/Tools reorg, /settings only owns
        // Appearance (ALL_ROLES), Mocks (anyAdmin), and SharedSteps.
        // Architectures / Recording / Validation moved to /admin
        // under the Behavior group; Activity / Maintenance moved to
        // /tools cards.
        [TestCase(SettingsSection.Appearance)]
        [TestCase(SettingsSection.Mocks)]
        public async Task Admin_sees_settings_section(SettingsSection section)
        {
            var settings = new SettingsPage(Page);
            (await settings.IsSectionVisibleAsync(section)).Should().BeTrue(
                $"Admin should see the {section} section in /settings.");
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class UserManagementTests : AdminFixture
    {
        protected override string StartPath => "/admin";

        [Test]
        public async Task Add_user_dialog_renders_inputs()
        {
            var settings = new SettingsPage(Page);
            await settings.OpenAddUserDialogAsync();
            (await Page.GetByTestId(
                PageObjects.Selectors.SettingsSelectors.InputNewUserUsername).IsVisibleAsync())
                .Should().BeTrue();
            await Page.GetByTestId(
                PageObjects.Selectors.SettingsSelectors.ButtonCancelAddUser).ClickAsync();
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class MocksSectionTests : AdminFixture
    {
        protected override string StartPath => "/settings";

        [Test]
        public async Task Mocks_section_renders_for_admin()
        {
            var settings = new SettingsPage(Page);
            (await settings.IsSectionVisibleAsync(SettingsSection.Mocks)).Should().BeTrue();
        }
    }
}
