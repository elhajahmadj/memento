using System.Threading.Tasks;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    /// <summary>
    /// Helper that navigates to /settings → Activity and counts
    /// audit rows whose action is <c>recorded_action_edit</c> and
    /// whose expanded details payload contains a specific server-side
    /// op tag (see
    /// <c>artifacts/api-server/src/features/recording/infrastructure/recordingService.ts</c>:
    /// <c>auditRecordedActionEdit</c> callsites).
    ///
    /// The Activity action-filter dropdown does NOT expose
    /// <c>recorded_action_edit</c> as a user-selectable option (see
    /// <c>artifacts/test-builder/src/features/settings/presentation/pages/settings-activity.tsx</c>
    /// <c>ACTION_OPTIONS</c>), so we cannot filter via the UI. Instead
    /// the helper iterates rendered rows on page 1 and matches both
    /// the action name (in the row header) and the op tag (in the
    /// expanded details). Tests use a strict before/after delta so
    /// historical rows can never produce a false positive.
    ///
    /// Implementation is fail-fast: each row's details panel MUST
    /// render before being inspected — failures bubble out rather
    /// than being silently swallowed.
    /// </summary>
    public sealed class AuditLogChecker
    {
        private readonly IPage _page;

        public AuditLogChecker(IPage page)
        {
            _page = page;
        }

        public async Task GotoActivityAsync()
        {
            await _page.GotoAsync(MementoSettings.BaseUrl + "/settings");
            await _page.GetByTestId(SettingsSelectors.SectionActivity)
                .First.WaitForAsync(new() { Timeout = 8000 });
            // Wait for either the audit-empty placeholder or at least one
            // audit row before we start counting.
            await _page.WaitForFunctionAsync(
                "() => !!document.querySelector('[data-testid=\"audit-empty\"]') "
                + "|| !!document.querySelector('[data-testid^=\"row-audit-\"]')",
                new PageWaitForFunctionOptions { Timeout = 8000 });
        }

        /// <summary>
        /// Returns the number of currently-rendered rows on page 1
        /// whose row text contains <c>recorded_action_edit</c> AND
        /// whose expanded details panel contains
        /// <paramref name="opTag"/>. Each candidate row is expanded
        /// by click and the details panel is required to render;
        /// failures bubble out of the helper.
        /// </summary>
        public async Task<int> CountRecordedActionEditRowsAsync(string opTag)
        {
            var rows = _page.Locator("[data-testid^=\"row-audit-\"]");
            var count = await rows.CountAsync();
            var matches = 0;
            for (var i = 0; i < count; i++)
            {
                var row = rows.Nth(i);
                var rowText = await row.InnerTextAsync();
                if (!rowText.Contains("recorded_action_edit")) continue;

                var rowId = (await row.GetAttributeAsync("data-testid"))?
                    .Replace("row-audit-", "") ?? string.Empty;
                if (string.IsNullOrEmpty(rowId)) continue;

                var details = _page.GetByTestId($"details-audit-{rowId}");
                if (await details.CountAsync() == 0 || !await details.First.IsVisibleAsync())
                {
                    await row.ClickAsync();
                    await details.First.WaitForAsync(new() { Timeout = 5000 });
                }
                var detailsText = await details.First.InnerTextAsync();
                if (detailsText.Contains(opTag)) matches++;
            }
            return matches;
        }

        public async Task<bool> HasRecordedActionEditRowAsync(string opTag) =>
            await CountRecordedActionEditRowsAsync(opTag) > 0;
    }
}
