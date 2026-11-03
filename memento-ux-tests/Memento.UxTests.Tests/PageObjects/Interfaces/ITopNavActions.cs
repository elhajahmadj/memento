using System.Threading.Tasks;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Interfaces
{
    public interface ITopNavActions
    {
        ILocator Logo();
        Task ClickLogoAsync();
        Task OpenUserMenuAsync();
        Task ClickMyProfileAsync();
        Task ClickTakeTourAsync();
        Task ClickSignOutAsync();
        Task<string> CurrentUserLabelAsync();
        Task OpenNotificationsAsync();
    }
}
