using System;
using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Api;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// /profile/complete is shown to first-time users — these tests
    /// only assert client-side validation paths so we don't burn a
    /// real seeded account's profile.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ProfileCompleteTests : AdminFixture
    {
        protected override string StartPath => "/profile/complete";

        [Test]
        public async Task Invalid_email_surfaces_inline_error()
        {
            if (!Page.Url.Contains("/profile/complete"))
            {
                Assert.Pass("Account does not need profile completion.");
                return;
            }
            var profile = new ProfileCompletePage(Page);
            await profile.FillAsync("Ada", "Lovelace", "QA", "not-an-email");
            await profile.SubmitAsync();
            (await profile.HasErrorAsync()).Should().BeTrue();
        }
    }

    /// <summary>
    /// Forced-redirect + happy-path coverage. Uses a freshly created
    /// user (not a cached-fixture role) so the account genuinely has
    /// `profile_complete = false` on first sign-in.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ProfileCompleteForcedRedirectTests : TestFixture
    {
        private string? _userId;
        private string? _username;
        private string? _password;

        [SetUp]
        public async Task CreateFreshUser()
        {
            var suffix = Guid.NewGuid().ToString("n")[..8];
            _username = $"qa-newhire-{suffix}";
            var created = await MementoApiClient.CreateUserAsAdminAsync(
                _username, role: "user");
            _userId = created.User.Id;
            _password = created.TemporaryPassword;
        }

        [TearDown]
        public async Task DeleteFreshUser()
        {
            if (!string.IsNullOrEmpty(_userId))
                await MementoApiClient.DeleteUserAsAdminAsync(_userId!);
        }

        [Test]
        public async Task First_sign_in_force_redirects_to_profile_complete()
        {
            var login = new LoginPage(Page);
            await login.GotoAsync();
            await login.SignInAsync(_username!, _password!);

            await Page.WaitForURLAsync(url => url.Contains("/profile/complete"));
            Page.Url.Should().Contain("/profile/complete");
        }

        [Test]
        public async Task Cannot_escape_to_settings_until_profile_complete()
        {
            var login = new LoginPage(Page);
            await login.GotoAsync();
            await login.SignInAsync(_username!, _password!);
            await Page.WaitForURLAsync(url => url.Contains("/profile/complete"));

            // Try to navigate elsewhere while incomplete — AuthGate
            // must bounce us back.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/settings");
            await Page.WaitForURLAsync(url => url.Contains("/profile/complete"));
            Page.Url.Should().Contain("/profile/complete");
        }

        [Test]
        public async Task Happy_path_completion_releases_the_redirect()
        {
            var login = new LoginPage(Page);
            await login.GotoAsync();
            await login.SignInAsync(_username!, _password!);
            await Page.WaitForURLAsync(url => url.Contains("/profile/complete"));

            var profile = new ProfileCompletePage(Page);
            await profile.FillAsync(
                "Ada", "Lovelace", "QA Engineer",
                $"{_username}@example.com");
            await profile.SubmitAsync();

            // After save, AuthGate stops forcing us to /profile/complete.
            await Page.WaitForURLAsync(url => !url.Contains("/profile/complete"));
            Page.Url.Should().NotContain("/profile/complete");
        }
    }
}
