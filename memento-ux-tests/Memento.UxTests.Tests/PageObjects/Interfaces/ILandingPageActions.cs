using System.Threading.Tasks;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Interfaces
{
    public interface ILandingPageActions
    {
        Task GotoAsync();
        Task ClickLoginAsync();
        ILocator Logo();
        ILocator LoginButton();
    }
}
