using System.Threading.Tasks;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    public sealed class StartRecordingDialog : PageObjectBase, IStartRecordingDialogActions
    {
        public StartRecordingDialog(IPage page) : base(page) { }

        public async Task SetStartUrlAsync(string url) =>
            await T(StartRecordingDialogSelectors.InputStartUrl).FillAsync(url);

        public async Task SetUrlNameAsync(string name) =>
            await T(StartRecordingDialogSelectors.InputUrlName).FillAsync(name);

        public async Task SetMethodNameAsync(string methodName) =>
            await T(StartRecordingDialogSelectors.InputMethodName).FillAsync(methodName);

        public async Task SetNewClassAsync(string className) =>
            await T(StartRecordingDialogSelectors.InputNewClass).FillAsync(className);

        public async Task PickTargetAsync(RecordingTarget target)
        {
            // The dialog uses a Radix RadioGroup; each item has a stable
            // DOM id (`target-test`, `target-before`, `target-onetime`)
            // that we click directly to avoid coupling to localized labels.
            var id = target switch
            {
                RecordingTarget.TestMethod   => "#target-test",
                RecordingTarget.BeforeEach   => "#target-before",
                RecordingTarget.OneTimeSetUp => "#target-onetime",
                _ => "#target-test",
            };
            var radio = Page.Locator(id);
            if (await radio.CountAsync() > 0)
            {
                await radio.First.ClickAsync();
            }
        }

        public async Task ConfirmStartAsync() =>
            await T(StartRecordingDialogSelectors.ButtonConfirmStartRecording).ClickAsync();

        public async Task<bool> IsHookOverwriteWarningVisibleAsync() =>
            await T(StartRecordingDialogSelectors.WarningHookHasCustomCode).IsVisibleAsync();

        public async Task ConfirmHookOverwriteAsync() =>
            await T(StartRecordingDialogSelectors.ButtonConfirmOverwriteHook).ClickAsync();

        public async Task CancelHookOverwriteAsync() =>
            await T(StartRecordingDialogSelectors.ButtonCancelOverwriteHook).ClickAsync();
    }
}
