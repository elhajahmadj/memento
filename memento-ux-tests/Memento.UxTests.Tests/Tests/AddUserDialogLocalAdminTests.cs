using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// Verifies that the Add User dialog hides the IDP (email-based)
    /// path for local admins. The seeded admin used by the UX suite
    /// signs in via the local username/password endpoint, so the
    /// server returns canProvisionInIdp:false on /api/auth/me and the
    /// dialog must fall back to its local-only Username form.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class AddUserDialogLocalAdminTests : AdminFixture
    {
        protected override string StartPath => "/settings";

        [Test]
        public async Task Local_admin_add_user_dialog_renders_username_only_no_idp_path()
        {
            var settings = new SettingsPage(Page);
            await settings.OpenAddUserDialogAsync();

            var usernameInput = Page.GetByTestId(SettingsSelectors.InputNewUserUsername);
            await usernameInput.WaitForAsync(new()
            {
                State = WaitForSelectorState.Visible,
                Timeout = 5000,
            });
            (await usernameInput.IsVisibleAsync()).Should().BeTrue(
                "local admins (no IDP access token) get the username/password form");

            // The IDP-only email input must not be present at all when
            // canProvisionInIdp is false.
            (await Page.GetByTestId("input-new-user-email").CountAsync()).Should().Be(0,
                "local admins must not see the email-based IDP provisioning input");

            // DialogDescription text differs based on canProvisionInIdp.
            // The local-admin description mentions "local username/password" and
            // explains *why* the IDP path is unavailable. The IDP-mode wording —
            // "Provisions the account in the identity provider" — must NOT appear.
            var description = await Page.Locator("[role=dialog] >> text=/local username\\/password/i")
                .First.InnerTextAsync();
            description.Should().Contain("local username/password");
            description.Should().NotContain("Provisions the account in the identity provider",
                "the IDP-mode description must not render for a local admin");
        }
    }
}
