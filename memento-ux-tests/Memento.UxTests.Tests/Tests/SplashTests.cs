using System;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Api;
using Memento.UxTests.Infrastructure.Auth;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// /splash is the post-login interstitial. Authenticated tests
    /// rarely see it (the role fixture starts at /), so we drive it
    /// directly here.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class SplashTests : AdminFixture
    {
        protected override string StartPath => "/splash";

        [Test]
        public async Task Splash_screen_shows_and_redirects()
        {
            var splash = new SplashPage(Page);
            // The splash auto-advances after ~3s; make sure we reach
            // an authenticated, non-splash URL.
            await splash.WaitForRedirectAsync();
            Page.Url.Should().NotContain("/splash");
        }

        [Test]
        public async Task Admin_splash_lands_on_home()
        {
            await new SplashPage(Page).WaitForRedirectAsync();
            new Uri(Page.Url).AbsolutePath.TrimEnd('/').Should().BeOneOf(string.Empty, "/",
                "an admin with a complete profile must land on /");
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class LimitedAdminSplashTests : LimitedAdminFixture
    {
        protected override string StartPath => "/splash";

        [Test]
        public async Task LimitedAdmin_splash_lands_on_home()
        {
            await new SplashPage(Page).WaitForRedirectAsync();
            new Uri(Page.Url).AbsolutePath.TrimEnd('/').Should().BeOneOf(string.Empty, "/");
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class UserSplashTests : UserFixture
    {
        protected override string StartPath => "/splash";

        [Test]
        public async Task User_splash_lands_on_home()
        {
            await new SplashPage(Page).WaitForRedirectAsync();
            new Uri(Page.Url).AbsolutePath.TrimEnd('/').Should().BeOneOf(string.Empty, "/");
        }
    }

    /// <summary>
    /// A freshly-created user has no profile fields yet, so AuthGate
    /// must skip /splash and route them straight to /profile/complete.
    /// We seed the user via the API and drive the real /login form so
    /// we exercise the full post-login flow.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class IncompleteProfileSplashRedirectTests : Memento.UxTests.Infrastructure.Fixtures.TestFixture
    {
        private sealed record CreatedUser(
            [property: JsonPropertyName("user")] User User,
            [property: JsonPropertyName("temporaryPassword")] string TemporaryPassword);

        private sealed record User(
            [property: JsonPropertyName("id")] string Id,
            [property: JsonPropertyName("username")] string Username,
            [property: JsonPropertyName("role")] string Role);

        [Test]
        public async Task New_user_with_incomplete_profile_is_redirected_to_profile_complete()
        {
            await using var api = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            var username = $"splash-incomplete-{DateTime.UtcNow:yyyyMMddHHmmssfff}";
            var resp = await api.PostJsonAsync("api/users", new
            {
                username,
                role = "limited",
            });
            resp.EnsureSuccessStatusCode();
            var created = await resp.Content.ReadFromJsonAsync<CreatedUser>(
                new JsonSerializerOptions(JsonSerializerDefaults.Web));
            created.Should().NotBeNull();

            // Drive the real /login form as the new user.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/login");
            // Two-step sign-in: type the username, click Next, then
            // fill the password once it appears.
            await Page.GetByTestId("input-username").FillAsync(username);
            await Page.GetByTestId("button-next").ClickAsync();
            await Page.GetByTestId("input-password").WaitForAsync(new()
            {
                State = WaitForSelectorState.Visible,
            });
            await Page.GetByTestId("input-password").FillAsync(created!.TemporaryPassword);
            await Page.GetByTestId("button-sign-in").ClickAsync();

            // AuthGate must route an incomplete-profile user to
            // /profile/complete, NEVER showing splash.
            await Page.WaitForURLAsync(url => url.Contains("/profile/complete"),
                new() { Timeout = 8000 });
            Page.Url.Should().Contain("/profile/complete");
        }
    }
}
