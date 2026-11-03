using System.Threading.Tasks;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    public sealed class RecordingCanvas : PageObjectBase, IRecordingCanvasActions
    {
        public RecordingCanvas(IPage page) : base(page) { }

        public async Task FillTypedValueAsync(string value) =>
            await T(RecordingCanvasSelectors.InputFillValue).FillAsync(value);

        public async Task ConfirmFillAsync() =>
            await T(RecordingCanvasSelectors.ButtonFillSubmit).ClickAsync();

        public async Task CancelFillAsync() =>
            await T(RecordingCanvasSelectors.ButtonFillCancel).ClickAsync();

        public async Task<string> ReadSuggestedMethodNameAsync()
        {
            var preview = T(RecordingCanvasSelectors.TextNameActionPreview);
            await preview.WaitForAsync();
            return await preview.InnerTextAsync();
        }

        public async Task AcceptNameAsync() =>
            await T(RecordingCanvasSelectors.ButtonNameActionSubmit).ClickAsync();

        public async Task EditNameAsync(string name)
        {
            await T(RecordingCanvasSelectors.InputActionMethodName).FillAsync(name);
            await AcceptNameAsync();
        }

        public async Task SkipNameAsync() =>
            await T(RecordingCanvasSelectors.ButtonNameActionSkip).ClickAsync();
    }
}
