using System.Threading.Tasks;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    public sealed class WorkbenchPage : PageObjectBase, IWorkbenchPageActions
    {
        public WorkbenchPage(IPage page) : base(page) { }

        public async Task GotoAsync() =>
            await Page.GotoAsync(MementoSettings.BaseUrl + "/workbench");

        public async Task OpenStartRecordingDialogAsync() =>
            await T(WorkbenchSelectors.ButtonStartRecording).ClickAsync();

        public async Task ClickStopRecordingAsync() =>
            await T(WorkbenchSelectors.ButtonStopRecording).ClickAsync();

        public async Task ClickSaveRecordingAsync() =>
            await T(WorkbenchSelectors.ButtonSaveRecording).ClickAsync();

        public async Task ClickRequestApprovalAsync() =>
            await T(WorkbenchSelectors.ButtonRequestApproval).ClickAsync();

        public async Task ClickHomeAsync() =>
            await T(WorkbenchSelectors.ButtonHome).ClickAsync();

        public async Task OpenAddAssertionAsync() =>
            await T(WorkbenchSelectors.ButtonAddAssertion).ClickAsync();

        public async Task OpenAddApiCheckAsync() =>
            await T(WorkbenchSelectors.ButtonAddApiCheck).ClickAsync();

        public async Task OpenWorkbenchActionsMenuAsync() =>
            await T(WorkbenchSelectors.ButtonWorkbenchActionsMenu).ClickAsync();

        public async Task OpenValidationPanelAsync()
        {
            await OpenWorkbenchActionsMenuAsync();
            await T(WorkbenchSelectors.ButtonOpenValidation).ClickAsync();
        }

        public async Task ClickValidateAllAsync() =>
            await T(WorkbenchSelectors.ButtonValidateAll).ClickAsync();

        public async Task PopOutRecordingAsync() =>
            await T(WorkbenchSelectors.ButtonPopoutRecording).ClickAsync();

        public async Task ClosePopOutAsync() =>
            await T(WorkbenchSelectors.ButtonClosePopoutRecording).ClickAsync();

        public async Task<bool> IsRecordingCanvasVisibleAsync() =>
            await T(WorkbenchSelectors.RecordingCanvas).IsVisibleAsync();

        public async Task<bool> IsValidationPanelOpenAsync() =>
            await T(WorkbenchSelectors.SheetValidationPanel).IsVisibleAsync();

        public ILocator RecordingCanvas() => T(WorkbenchSelectors.RecordingCanvas);
    }
}
