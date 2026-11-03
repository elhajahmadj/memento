using System.Threading.Tasks;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    /// <summary>
    /// Boots a recording session against the deterministic
    /// <c>/api/ux-fixture</c> page (see
    /// <c>artifacts/api-server/src/shared/routes/uxFixture.ts</c>).
    /// The fixture is split into seven equal vertical bands so that
    /// coordinate-based clicks on the recorder canvas reliably target
    /// a specific element kind regardless of the embedded browser's
    /// viewport size.
    ///
    /// Band centers (yPct):
    ///   1: 0.07  heading
    ///   2: 0.21  &lt;input&gt;            (#ux-input)
    ///   3: 0.36  &lt;textarea&gt;         (#ux-textarea)
    ///   4: 0.50  contenteditable      (#ux-contenteditable)
    ///   5: 0.64  &lt;select&gt;           (#ux-select)
    ///   6: 0.78  checkbox             (#ux-checkbox)
    ///   7: 0.93  &lt;button&gt;           (#ux-button)
    /// </summary>
    public sealed class RecorderFlowHelper
    {
        public const string FixtureUrl = "/api/ux-fixture";
        public const string FixtureUrlName = "UxFixturePage";

        public const double YHeading = 0.07;
        public const double YInput = 0.21;
        public const double YTextarea = 0.36;
        public const double YContentEditable = 0.50;
        public const double YSelect = 0.64;
        public const double YCheckbox = 0.78;
        public const double YButton = 0.93;

        private readonly IPage _page;

        public RecorderFlowHelper(IPage page)
        {
            _page = page;
        }

        public async Task<int> CurrentRowCountAsync() =>
            await _page.Locator("[data-testid^=\"action-feed-item-\"]").CountAsync();

        public async Task<bool> EnsureCanStartAsync()
        {
            var btn = _page.GetByTestId(WorkbenchSelectors.ButtonStartRecording);
            if (await btn.CountAsync() == 0) return false;
            return await btn.IsEnabledAsync();
        }

        public async Task<bool> IsRecordingActiveAsync() =>
            await _page.GetByTestId(WorkbenchSelectors.ButtonStopRecording).IsVisibleAsync();

        public Task<bool> StartTestMethodRecordingAsync(
            string methodName = "RecordedFlow",
            string newClassName = "RecorderUxTests")
            => StartRecordingAsync(RecordingTarget.TestMethod, methodName, newClassName);

        public Task<bool> StartHookRecordingAsync(RecordingTarget hook)
            => StartRecordingAsync(hook, methodName: null, newClassName: "RecorderUxTests");

        public async Task<bool> StartRecordingAsync(
            RecordingTarget target,
            string? methodName,
            string newClassName)
        {
            await _page.GetByTestId(WorkbenchSelectors.ButtonStartRecording).ClickAsync();
            var dialog = new StartRecordingDialog(_page);
            await dialog.SetStartUrlAsync(MementoSettings.BaseUrl + FixtureUrl);
            await dialog.SetUrlNameAsync(FixtureUrlName);
            await dialog.PickTargetAsync(target);
            await dialog.SetNewClassAsync(newClassName);
            if (target == RecordingTarget.TestMethod && methodName != null)
            {
                await dialog.SetMethodNameAsync(methodName);
            }
            return await TryConfirmAsync();
        }

        public async Task StopAsync()
        {
            var stop = _page.GetByTestId(WorkbenchSelectors.ButtonStopRecording);
            if (await stop.CountAsync() > 0 && await stop.IsVisibleAsync())
            {
                await stop.ClickAsync();
                try
                {
                    await _page.GetByTestId(WorkbenchSelectors.TextRecordingStopped)
                        .First.WaitForAsync(new() { Timeout = 5000 });
                }
                catch { /* tolerated — best-effort wait */ }
            }
        }

        public async Task DiscardAsync()
        {
            var discard = _page.GetByTestId(WorkbenchSelectors.ButtonDiscardRecording);
            if (await discard.CountAsync() > 0 && await discard.IsVisibleAsync())
            {
                await discard.ClickAsync();
            }
        }

        private async Task<bool> TryConfirmAsync()
        {
            var confirm = _page.GetByTestId(StartRecordingDialogSelectors.ButtonConfirmStartRecording);
            if (await confirm.CountAsync() == 0) return false;
            if (!await confirm.IsEnabledAsync()) return false;
            await confirm.ClickAsync();
            try
            {
                await _page.GetByTestId(WorkbenchSelectors.ButtonStopRecording)
                    .First.WaitForAsync(new() { Timeout = 8000 });
                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}
