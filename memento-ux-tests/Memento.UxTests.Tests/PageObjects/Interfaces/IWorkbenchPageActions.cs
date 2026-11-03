using System.Threading.Tasks;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Interfaces
{
    public interface IWorkbenchPageActions
    {
        Task GotoAsync();
        Task OpenStartRecordingDialogAsync();
        Task ClickStopRecordingAsync();
        Task ClickSaveRecordingAsync();
        Task ClickRequestApprovalAsync();
        Task ClickHomeAsync();
        Task OpenAddAssertionAsync();
        Task OpenAddApiCheckAsync();
        Task OpenValidationPanelAsync();
        Task ClickValidateAllAsync();
        Task PopOutRecordingAsync();
        Task ClosePopOutAsync();
        Task<bool> IsRecordingCanvasVisibleAsync();
        Task<bool> IsValidationPanelOpenAsync();
        ILocator RecordingCanvas();
    }
}
