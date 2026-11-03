using System.Threading.Tasks;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    public sealed class DocumentationPage : PageObjectBase, IDocumentationPageActions
    {
        public DocumentationPage(IPage page) : base(page) { }

        public async Task GotoAsync(string? sectionId = null)
        {
            var url = MementoSettings.BaseUrl + "/documentation"
                + (string.IsNullOrEmpty(sectionId) ? string.Empty : "/" + sectionId);
            await Page.GotoAsync(url);
        }

        public ILocator Sidebar() => T(DocumentationSelectors.Sidebar);
        public ILocator Main() => T(DocumentationSelectors.Main);

        public async Task<bool> IsLayoutVisibleAsync() =>
            await T(DocumentationSelectors.Layout).IsVisibleAsync();

        public async Task<bool> IsEmptyStateVisibleAsync() =>
            await T(DocumentationSelectors.Empty).IsVisibleAsync();

        public async Task<int> SidebarEntryCountAsync() =>
            await Sidebar().Locator("[data-testid^=\"documentation-nav-\"]").CountAsync();

        public async Task ClickSidebarEntryAsync(string sectionId) =>
            await T(DocumentationSelectors.Nav(sectionId)).ClickAsync();

        public async Task<bool> IsSectionVisibleAsync(string sectionId) =>
            await T(DocumentationSelectors.Section(sectionId)).IsVisibleAsync();

        public async Task<string> ReadHeadingAsync(string sectionId) =>
            await T(DocumentationSelectors.Heading(sectionId)).InnerTextAsync();
    }

    public sealed class AboutPage : PageObjectBase, IAboutPageActions
    {
        public AboutPage(IPage page) : base(page) { }

        public async Task GotoAsync() =>
            await Page.GotoAsync(MementoSettings.BaseUrl + "/about");

        public async Task<string> ReadTitleAsync() =>
            await T(AboutSelectors.TextTitle).InnerTextAsync();

        public async Task<string> ReadCreatorNameAsync() =>
            await T(AboutSelectors.TextCreatorName).InnerTextAsync();

        public async Task<string> ReadVersionAsync() =>
            await T(AboutSelectors.TextVersion).InnerTextAsync();
    }

    public sealed class OnboardingTour : PageObjectBase, IOnboardingTourActions
    {
        public OnboardingTour(IPage page) : base(page) { }

        public async Task<bool> IsOpenAsync() =>
            await T(OnboardingTourSelectors.Card).IsVisibleAsync();

        public async Task NextAsync() =>
            await T(OnboardingTourSelectors.ButtonNext).ClickAsync();

        public async Task PrevAsync() =>
            await T(OnboardingTourSelectors.ButtonPrev).ClickAsync();

        public async Task FinishAsync() =>
            await T(OnboardingTourSelectors.ButtonFinish).ClickAsync();

        public async Task CloseAsync() =>
            await T(OnboardingTourSelectors.ButtonClose).ClickAsync();

        public async Task ClickBackdropAsync()
        {
            // The overlay div listens to clicks on its own backdrop area
            // (the card uses stopPropagation). Click in a corner that is
            // outside the card so the dismissal handler fires.
            var overlay = T(OnboardingTourSelectors.Overlay);
            var box = await overlay.BoundingBoxAsync();
            if (box is null) return;
            await Page.Mouse.ClickAsync((float)(box.X + 8), (float)(box.Y + 8));
        }

        public async Task<string> ReadStepTitleAsync() =>
            await T(OnboardingTourSelectors.Title).InnerTextAsync();

        public async Task<string> ReadStepBodyAsync() =>
            await T(OnboardingTourSelectors.Body).InnerTextAsync();

        public async Task WaitForOpenAsync() =>
            await T(OnboardingTourSelectors.Card)
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });
    }

    public sealed class MyApprovalsPage : PageObjectBase, IMyApprovalsPageActions
    {
        public MyApprovalsPage(IPage page) : base(page) { }

        public async Task GotoAsync() =>
            await Page.GotoAsync(MementoSettings.BaseUrl + "/my-approvals");

        public async Task<bool> IsEmptyAsync() =>
            await T(MyApprovalsSelectors.Empty).IsVisibleAsync();

        public async Task<int> CountAsync() =>
            await T(MyApprovalsSelectors.List).Locator("[data-testid^=\"my-approval-\"]").CountAsync();
    }

    public sealed class ProfileCompletePage : PageObjectBase, IProfileCompletePageActions
    {
        public ProfileCompletePage(IPage page) : base(page) { }

        public async Task GotoAsync() =>
            await Page.GotoAsync(MementoSettings.BaseUrl + "/profile/complete");

        public async Task FillAsync(string firstName, string lastName, string title, string email)
        {
            await T(ProfileCompleteSelectors.InputFirstName).FillAsync(firstName);
            await T(ProfileCompleteSelectors.InputLastName).FillAsync(lastName);
            await T(ProfileCompleteSelectors.InputTitle).FillAsync(title);
            await T(ProfileCompleteSelectors.InputEmail).FillAsync(email);
        }

        public async Task SubmitAsync() =>
            await T(ProfileCompleteSelectors.ButtonSaveProfile).ClickAsync();

        public async Task<bool> HasErrorAsync() =>
            await T(ProfileCompleteSelectors.TextProfileError).IsVisibleAsync()
            || await T(ProfileCompleteSelectors.TextEmailInvalid).IsVisibleAsync();
    }

    public sealed class SplashPage : PageObjectBase, ISplashPageActions
    {
        public SplashPage(IPage page) : base(page) { }

        public async Task<bool> IsVisibleAsync() =>
            await T(SplashSelectors.Screen).IsVisibleAsync();

        public async Task WaitForRedirectAsync() =>
            await Page.WaitForURLAsync(url => !url.Contains("/splash"));
    }
}
