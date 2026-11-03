using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Auth;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// Auth smoke tests — exercise the real /login form for each of the
    /// three seeded roles. Does NOT use the cached-storage fixture: the
    /// whole point is to prove the login flow itself works end-to-end.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class AuthTests : TestFixture
    {
        [Test]
        public async Task AdminRole_can_sign_in_through_real_login_form()
        {
            var login = new LoginPage(Page);
            await login.GotoAsync();
            await login.SignInAsync(
                MementoSettings.AdminCredentials.Username,
                MementoSettings.AdminCredentials.Password);

            await Page.WaitForURLAsync(url => !url.Contains("/login"));
            Page.Url.Should().NotContain("/login");
        }

        [Test]
        public async Task LimitedAdminRole_can_sign_in()
        {
            var login = new LoginPage(Page);
            await login.GotoAsync();
            await login.SignInAsync(
                MementoSettings.LimitedAdminCredentials.Username,
                MementoSettings.LimitedAdminCredentials.Password);

            await Page.WaitForURLAsync(url => !url.Contains("/login"));
            Page.Url.Should().NotContain("/login");
        }

        [Test]
        public async Task MementoAdminRole_can_sign_in()
        {
            var login = new LoginPage(Page);
            await login.GotoAsync();
            await login.SignInAsync(
                MementoSettings.MementoAdminCredentials.Username,
                MementoSettings.MementoAdminCredentials.Password);

            await Page.WaitForURLAsync(url => !url.Contains("/login"));
            Page.Url.Should().NotContain("/login");
        }

        [Test]
        public async Task UserRole_can_sign_in()
        {
            var login = new LoginPage(Page);
            await login.GotoAsync();
            await login.SignInAsync(
                MementoSettings.UserCredentials.Username,
                MementoSettings.UserCredentials.Password);

            await Page.WaitForURLAsync(url => !url.Contains("/login"));
            Page.Url.Should().NotContain("/login");
        }

        [Test]
        public async Task Wrong_password_surfaces_login_error_message()
        {
            var login = new LoginPage(Page);
            await login.GotoAsync();
            await login.SignInAsync(MementoSettings.AdminCredentials.Username, "definitely-wrong");

            var error = await login.ReadErrorAsync();
            error.Should().NotBeNullOrWhiteSpace();
            Page.Url.Should().Contain("/login");
        }

        [Test]
        public async Task Unknown_user_surfaces_login_error_message()
        {
            var login = new LoginPage(Page);
            await login.GotoAsync();
            await login.SignInAsync("no-such-account", "Temporary1!");

            var error = await login.ReadErrorAsync();
            error.Should().NotBeNullOrWhiteSpace();
        }

        [Test]
        public async Task Username_step_advances_to_password_step_with_prepopulated_username()
        {
            var login = new LoginPage(Page);
            await login.GotoAsync();
            // Step 1: only the username field + Next button are visible.
            (await login.PasswordInput().IsVisibleAsync()).Should().BeFalse();
            (await login.SignInButton().IsVisibleAsync()).Should().BeFalse();

            await login.SubmitIdentifierAsync(MementoSettings.AdminCredentials.Username);

            // Step 2: password field appears and the username is locked-in.
            await login.PasswordInput().WaitForAsync(new()
            {
                State = WaitForSelectorState.Visible,
            });
            (await login.UsernameInput().InputValueAsync())
                .Should().Be(MementoSettings.AdminCredentials.Username);
            (await login.SignInButton().IsVisibleAsync()).Should().BeTrue();

            await login.PasswordInput().FillAsync(MementoSettings.AdminCredentials.Password);
            await login.SignInButton().ClickAsync();
            await Page.WaitForURLAsync(url => !url.Contains("/login"));
            Page.Url.Should().NotContain("/login");
        }

        [Test]
        public async Task Email_identifier_redirects_browser_to_sso_login_endpoint()
        {
            var login = new LoginPage(Page);
            await login.GotoAsync();

            // Intercept the outbound /api/auth/sso/login navigation
            // before it leaves the SPA so we don't need to round-trip
            // through Nexus to assert the redirect was issued.
            string? redirectedTo = null;
            await Page.RouteAsync("**/api/auth/sso/login*", async route =>
            {
                redirectedTo = route.Request.Url;
                await route.FulfillAsync(new()
                {
                    Status = 204,
                    Body = string.Empty,
                });
            });

            await login.SubmitIdentifierAsync("someone@example.com");

            await Assertions.Expect(login.UsernameInput()).ToBeVisibleAsync();
            redirectedTo.Should().NotBeNull();
            redirectedTo!.Should().Contain("/api/auth/sso/login");
            redirectedTo!.Should().Contain("login_hint=someone%40example.com");
        }
    }

    /// <summary>
    /// Sign-out via top-nav menu, signed in as Admin via cached storage.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class SignOutTests : AdminFixture
    {
        [Test]
        public async Task Admin_can_sign_out_from_top_nav_menu()
        {
            var nav = new TopNav(Page);
            try
            {
                await nav.ClickSignOutAsync();
                // UserMenu.signOut → logout() → navigate("/logged-out"). The
                // post-logout confirmation page is the contracted landing
                // spot; /login is only reachable from there via "Sign in
                // again", so the assertion lives on /logged-out.
                await Page.WaitForURLAsync(url => url.Contains("/logged-out"));
                Page.Url.Should().Contain("/logged-out");
            }
            finally
            {
                // Sign-out destroys the server-side session that backs the
                // cached storage cookie. Always invalidate so the next
                // fixture re-signs in cleanly, even if the assertions
                // above threw — otherwise downstream fixtures inherit a
                // dead cookie and silently render the signed-out Landing.
                RoleSession.InvalidateCachedStorage(MementoRole.Admin);
            }
        }
    }

    /// <summary>
    /// Sign-out parity — every role must reach /login via the same
    /// top-nav menu entry, with no role-specific gating.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class MementoAdminSignOutTests : MementoAdminFixture
    {
        [Test]
        public async Task MementoAdmin_can_sign_out_from_top_nav_menu()
        {
            var nav = new TopNav(Page);
            try
            {
                await nav.ClickSignOutAsync();
                await Page.WaitForURLAsync(url => url.Contains("/logged-out"));
                Page.Url.Should().Contain("/logged-out");
            }
            finally
            {
                RoleSession.InvalidateCachedStorage(MementoRole.MementoAdmin);
            }
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class LimitedAdminSignOutTests : LimitedAdminFixture
    {
        [Test]
        public async Task LimitedAdmin_can_sign_out_from_top_nav_menu()
        {
            var nav = new TopNav(Page);
            try
            {
                await nav.ClickSignOutAsync();
                await Page.WaitForURLAsync(url => url.Contains("/logged-out"));
                Page.Url.Should().Contain("/logged-out");
            }
            finally
            {
                RoleSession.InvalidateCachedStorage(MementoRole.LimitedAdmin);
            }
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class UserSignOutTests : UserFixture
    {
        [Test]
        public async Task User_can_sign_out_from_top_nav_menu()
        {
            var nav = new TopNav(Page);
            try
            {
                await nav.ClickSignOutAsync();
                await Page.WaitForURLAsync(url => url.Contains("/logged-out"));
                Page.Url.Should().Contain("/logged-out");
            }
            finally
            {
                RoleSession.InvalidateCachedStorage(MementoRole.User);
            }
        }
    }
}
