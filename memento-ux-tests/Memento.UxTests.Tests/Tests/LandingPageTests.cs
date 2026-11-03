using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// Public landing page smoke test. Visiting `/` while signed out
    /// must show the marketing landing page (logo + Login button), and
    /// the Login button must navigate to the existing /login screen.
    /// Uses TestFixture (no cached storage) so the session starts
    /// signed-out, mirroring a fresh visitor.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class LandingPageTests : TestFixture
    {
        [Test]
        public async Task Landing_renders_logo_and_login_button_for_signed_out_visitor()
        {
            var landing = new LandingPage(Page);
            await landing.GotoAsync();

            await landing.Logo().WaitForAsync(new() { State = WaitForSelectorState.Visible });
            await landing.LoginButton().WaitForAsync(new() { State = WaitForSelectorState.Visible });

            Page.Url.Should().NotContain("/login");
        }

        [Test]
        public async Task Landing_login_button_navigates_to_login_screen()
        {
            var landing = new LandingPage(Page);
            await landing.GotoAsync();
            await landing.LoginButton().WaitForAsync(new() { State = WaitForSelectorState.Visible });

            await landing.ClickLoginAsync();

            await Page.WaitForURLAsync(url => url.Contains("/login"));
            Page.Url.Should().Contain("/login");

            // The existing sign-in form is rendered.
            var login = new LoginPage(Page);
            await login.UsernameInput().WaitForAsync(new() { State = WaitForSelectorState.Visible });
        }
    }
}
