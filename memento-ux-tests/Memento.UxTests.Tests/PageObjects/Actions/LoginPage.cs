using System.Threading.Tasks;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    public sealed class LoginPage : PageObjectBase, ILoginPageActions
    {
        public LoginPage(IPage page) : base(page) { }

        public async Task GotoAsync()
        {
            await Page.GotoAsync(MementoSettings.BaseUrl + "/login");
        }

        public async Task SignInAsync(string username, string password)
        {
            await SubmitIdentifierAsync(username);
            // Step 2: the password field appears once Next is clicked.
            await T(LoginSelectors.InputPassword).WaitForAsync(
                new() { State = WaitForSelectorState.Visible });
            await T(LoginSelectors.InputPassword).FillAsync(password);
            await T(LoginSelectors.ButtonSignIn).ClickAsync();
        }

        public async Task SubmitIdentifierAsync(string identifier)
        {
            await T(LoginSelectors.InputUsername).FillAsync(identifier);
            await T(LoginSelectors.ButtonNext).ClickAsync();
        }

        public async Task<string> ReadErrorAsync()
        {
            var error = T(LoginSelectors.TextLoginError);
            await error.WaitForAsync(new() { State = WaitForSelectorState.Visible });
            return await error.InnerTextAsync();
        }

        public ILocator UsernameInput() => T(LoginSelectors.InputUsername);
        public ILocator NextButton() => T(LoginSelectors.ButtonNext);
        public ILocator PasswordInput() => T(LoginSelectors.InputPassword);
        public ILocator SignInButton() => T(LoginSelectors.ButtonSignIn);
        public ILocator BackToUsernameButton() => T(LoginSelectors.ButtonBackToUsername);
    }
}
