using System.Threading.Tasks;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    public sealed class HomePage : PageObjectBase, IHomePageActions
    {
        public HomePage(IPage page) : base(page) { }

        public async Task GotoAsync() =>
            await Page.GotoAsync(MementoSettings.BaseUrl + "/");

        public async Task ClickNewProjectAsync()
        {
            // Either the populated CTA or the empty-state CTA is present.
            var primary = T(HomeSelectors.ButtonNewProject);
            if (await primary.CountAsync() > 0)
            {
                await primary.ClickAsync();
                return;
            }
            await T(HomeSelectors.ButtonAddProjectEmpty).ClickAsync();
        }

        public async Task<bool> IsProjectListVisibleAsync() =>
            await T(HomeSelectors.ListProjects).IsVisibleAsync();

        public async Task<bool> IsForkListVisibleAsync() =>
            await T(HomeSelectors.ForkList).IsVisibleAsync();

        public async Task<bool> IsTryDemoCardVisibleAsync() =>
            await T(HomeSelectors.CardTryTheDemo).IsVisibleAsync();

        public async Task ClickTryDemoAsync() =>
            await T(HomeSelectors.ButtonTryDemo).ClickAsync();

        public ILocator ProjectsList() => T(HomeSelectors.ListProjects);

        // ---- Role-matrix helpers ----------------------------------------

        public async Task<int> CreateProjectCtaCountAsync() =>
            await T(HomeSelectors.ButtonNewProject).CountAsync()
            + await T(HomeSelectors.ButtonAddProjectEmpty).CountAsync();

        public async Task<int> EmptyStateCountAsync() =>
            await T(HomeSelectors.TextNoProjects).CountAsync();

        public async Task<int> ProjectListCountAsync() =>
            await T(HomeSelectors.ListProjects).CountAsync();

        public async Task<int> ForkListCountAsync() =>
            await T(HomeSelectors.ForkList).CountAsync();

        public async Task<int> DeleteButtonCountAsync() =>
            await Page.Locator("[data-testid^=\"button-delete-\"]").CountAsync();

        public async Task<int> LoadButtonCountAsync() =>
            await Page.Locator("[data-testid^=\"button-load-\"]").CountAsync();

        public ILocator NoAccessRows() =>
            Page.Locator("[data-testid^=\"row-no-access-\"]");

        public static async Task<bool> RowHasRequestAccessAsync(ILocator row) =>
            await row.Locator("[data-testid^=\"button-request-access-\"]").CountAsync() > 0;

        public static async Task<bool> RowHasPendingAsync(ILocator row) =>
            await row.Locator("[data-testid^=\"text-access-pending-\"]").CountAsync() > 0;

        public static async Task<bool> RowHasLoadAsync(ILocator row) =>
            await row.Locator("[data-testid^=\"button-load-\"]").CountAsync() > 0;
    }
}
