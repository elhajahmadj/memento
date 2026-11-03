using System.Threading.Tasks;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    public sealed class TopNav : PageObjectBase, ITopNavActions
    {
        public TopNav(IPage page) : base(page) { }

        public ILocator Logo() => T(TopNavSelectors.LogoMemento);

        public async Task ClickLogoAsync() => await Logo().ClickAsync();

        public async Task OpenUserMenuAsync()
        {
            await T(TopNavSelectors.ButtonUserMenu).ClickAsync();
        }

        public async Task ClickMyProfileAsync()
        {
            await OpenUserMenuAsync();
            await T(TopNavSelectors.MenuItemMyProfile).ClickAsync();
        }

        public async Task ClickTakeTourAsync()
        {
            await OpenUserMenuAsync();
            await T(TopNavSelectors.MenuItemTakeTour).ClickAsync();
        }

        public async Task ClickSignOutAsync()
        {
            await OpenUserMenuAsync();
            await T(TopNavSelectors.ButtonSignOut).ClickAsync();
        }

        public async Task<string> CurrentUserLabelAsync()
        {
            var label = T(TopNavSelectors.TextCurrentUser);
            await label.WaitForAsync();
            return await label.InnerTextAsync();
        }

        public async Task OpenNotificationsAsync()
        {
            await T(TopNavSelectors.ButtonNotifications).ClickAsync();
        }

        // ---- Role-matrix helpers ----------------------------------------

        private static string NavLinkTestId(string label) =>
            $"nav-link-{label.ToLowerInvariant()}";

        public ILocator NavLink(string label) => T(NavLinkTestId(label));

        public async Task<int> NavLinkCountAsync(string label) =>
            await NavLink(label).CountAsync();

        public async Task<bool> IsNavLinkVisibleAsync(string label)
        {
            // IsVisibleAsync samples synchronously and returns false if the
            // React app has not finished hydrating the top nav yet — which
            // is racy on a fresh navigation. Wait up to 5s for the link to
            // become visible; treat a timeout as a clean "not visible" so
            // negative assertions still work.
            try
            {
                await NavLink(label).WaitForAsync(new()
                {
                    State = WaitForSelectorState.Visible,
                    Timeout = 5000,
                });
                return true;
            }
            catch (TimeoutException)
            {
                return false;
            }
        }
    }
}
