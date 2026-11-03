using System.Threading.Tasks;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Interfaces
{
    public interface IHomePageActions
    {
        Task GotoAsync();
        Task ClickNewProjectAsync();
        Task<bool> IsProjectListVisibleAsync();
        Task<bool> IsForkListVisibleAsync();
        Task<bool> IsTryDemoCardVisibleAsync();
        Task ClickTryDemoAsync();
        ILocator ProjectsList();
    }
}
