using System.Threading.Tasks;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Interfaces
{
    public interface ILoginPageActions
    {
        Task GotoAsync();
        /// <summary>
        /// Drives the full two-step sign-in flow: type the username,
        /// click Next, type the password, click Sign in.
        /// </summary>
        Task SignInAsync(string username, string password);
        /// <summary>
        /// Type an identifier and click Next without supplying a
        /// password. Use for the email → SSO redirect path or to assert
        /// what step 2 looks like before submitting.
        /// </summary>
        Task SubmitIdentifierAsync(string identifier);
        Task<string> ReadErrorAsync();
        ILocator UsernameInput();
        ILocator NextButton();
        ILocator PasswordInput();
        ILocator SignInButton();
        ILocator BackToUsernameButton();
    }
}
