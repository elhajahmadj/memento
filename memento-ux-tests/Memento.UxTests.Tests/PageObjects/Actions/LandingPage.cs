using System.Threading.Tasks;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    public sealed class LandingPage : PageObjectBase, ILandingPageActions
    {
        public LandingPage(IPage page) : base(page) { }

        public async Task GotoAsync()
        {
            await Page.GotoAsync(MementoSettings.BaseUrl + "/");
        }

        public async Task ClickLoginAsync()
        {
            await T(LandingSelectors.LandingLoginButton).ClickAsync();
        }

        public ILocator Logo() => T(LandingSelectors.LandingLogo);
        public ILocator LoginButton() => T(LandingSelectors.LandingLoginButton);
    }
}
