using System.Threading.Tasks;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Interfaces
{
    public interface IDocumentationPageActions
    {
        Task GotoAsync(string? sectionId = null);
        ILocator Sidebar();
        ILocator Main();
        Task<bool> IsLayoutVisibleAsync();
        Task<bool> IsEmptyStateVisibleAsync();
        Task<int> SidebarEntryCountAsync();
        Task ClickSidebarEntryAsync(string sectionId);
        Task<bool> IsSectionVisibleAsync(string sectionId);
        Task<string> ReadHeadingAsync(string sectionId);
    }

    public interface IAboutPageActions
    {
        Task GotoAsync();
        Task<string> ReadTitleAsync();
        Task<string> ReadCreatorNameAsync();
        Task<string> ReadVersionAsync();
    }

    public interface IOnboardingTourActions
    {
        Task<bool> IsOpenAsync();
        Task NextAsync();
        Task PrevAsync();
        Task FinishAsync();
        Task CloseAsync();
        Task ClickBackdropAsync();
        Task<string> ReadStepTitleAsync();
        Task<string> ReadStepBodyAsync();
        Task WaitForOpenAsync();
    }

    public interface IMyApprovalsPageActions
    {
        Task GotoAsync();
        Task<bool> IsEmptyAsync();
        Task<int> CountAsync();
    }

    public interface IProfileCompletePageActions
    {
        Task GotoAsync();
        Task FillAsync(string firstName, string lastName, string title, string email);
        Task SubmitAsync();
        Task<bool> HasErrorAsync();
    }

    public interface ISplashPageActions
    {
        Task<bool> IsVisibleAsync();
        Task WaitForRedirectAsync();
    }
}
