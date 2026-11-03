using System.Globalization;
using System.Threading.Tasks;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    public sealed class AddApiCheckDialog : PageObjectBase, IAddApiCheckDialogActions
    {
        public AddApiCheckDialog(IPage page) : base(page) { }

        public async Task FillRequestAsync(string method, string url, string? body = null)
        {
            await T(AddApiCheckDialogSelectors.SelectMethod).SelectOptionAsync(method);
            await T(AddApiCheckDialogSelectors.InputUrl).FillAsync(url);
            if (!string.IsNullOrEmpty(body))
                await T(AddApiCheckDialogSelectors.InputBody).FillAsync(body);
        }

        public async Task FillExpectedAsync(int statusCode, string? expectedJson = null)
        {
            await T(AddApiCheckDialogSelectors.InputStatus)
                .FillAsync(statusCode.ToString(CultureInfo.InvariantCulture));
            if (!string.IsNullOrEmpty(expectedJson))
                await T(AddApiCheckDialogSelectors.InputExpectedJson).FillAsync(expectedJson);
        }

        public async Task SubmitAsync() =>
            await T(AddApiCheckDialogSelectors.ButtonAdd).ClickAsync();

        public async Task CancelAsync() =>
            await T(AddApiCheckDialogSelectors.ButtonCancel).ClickAsync();
    }
}
