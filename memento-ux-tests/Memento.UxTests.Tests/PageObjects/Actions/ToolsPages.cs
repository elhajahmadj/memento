using System.Threading.Tasks;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    public sealed class ToolsLandingPage : PageObjectBase, IToolsLandingActions
    {
        public ToolsLandingPage(IPage page) : base(page) { }
        public async Task GotoAsync() => await Page.GotoAsync(MementoSettings.BaseUrl + "/tools");
        public async Task<bool> IsCardVisibleAsync(string cardTestId) =>
            await T(cardTestId).IsVisibleAsync();
        public async Task<int> CardCountAsync(string cardTestId) =>
            await T(cardTestId).CountAsync();
    }

    public sealed class ToolsApprovalPage : PageObjectBase, IToolsApprovalActions
    {
        public ToolsApprovalPage(IPage page) : base(page) { }

        public async Task GotoAsync() =>
            // Approval moved into /admin as a CollapsibleSection. The
            // RedirectTo route for /admin/approval also opens the
            // section by default, so all approval-tab selectors are
            // reachable here.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/approval");

        public async Task SwitchToTabAsync(string tabTestId) =>
            await T(tabTestId).ClickAsync();

        public async Task<bool> IsEmptyAsync() =>
            await T(ToolsApprovalSelectors.ApprovalEmpty).IsVisibleAsync();

        public async Task<int> CountSubmissionsAsync() =>
            await T(ToolsApprovalSelectors.ApprovalList).Locator("[data-testid^=\"approval-item-\"]").CountAsync();

        public async Task ApproveFirstAsync(string? comment = null)
        {
            await T(ToolsApprovalSelectors.ButtonApprove).First.ClickAsync();
            if (!string.IsNullOrEmpty(comment))
                await T(ToolsApprovalSelectors.InputDecisionComment).FillAsync(comment);
            await T(ToolsApprovalSelectors.ButtonDecisionConfirm).ClickAsync();
        }

        public async Task RejectFirstAsync(string comment)
        {
            await T(ToolsApprovalSelectors.ButtonReject).First.ClickAsync();
            await T(ToolsApprovalSelectors.InputDecisionComment).FillAsync(comment);
            await T(ToolsApprovalSelectors.ButtonDecisionConfirm).ClickAsync();
        }
    }

    public sealed class ToolsForkRequestsPage : PageObjectBase, IToolsForkRequestsActions
    {
        public ToolsForkRequestsPage(IPage page) : base(page) { }
        public async Task GotoAsync() =>
            // Fork requests moved into /admin as a CollapsibleSection.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/fork-requests");

        public async Task<int> CountPendingAsync() =>
            await T(ToolsForkRequestsSelectors.ListPendingForks)
                .Locator("[data-testid^=\"fork-pending-\"]").CountAsync();

        public async Task<int> CountActiveAsync() =>
            await T(ToolsForkRequestsSelectors.ListActiveForks)
                .Locator("[data-testid^=\"fork-active-\"]").CountAsync();

        public async Task CreateForkAsync(string username, string projectName)
        {
            await T(ToolsForkRequestsSelectors.SelectForkUser).SelectOptionAsync(new SelectOptionValue { Label = username });
            await T(ToolsForkRequestsSelectors.SelectForkProject).SelectOptionAsync(new SelectOptionValue { Label = projectName });
            await T(ToolsForkRequestsSelectors.ButtonCreateFork).ClickAsync();
        }
    }

    public sealed class ToolsProjectAssignmentsPage : PageObjectBase, IToolsProjectAssignmentsActions
    {
        public ToolsProjectAssignmentsPage(IPage page) : base(page) { }
        public async Task GotoAsync() =>
            // Project assignments moved into /admin (Admin-only section).
            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/project-assignments");

        public async Task<int> CountAccessRequestsAsync() =>
            await T(ToolsProjectAssignmentsSelectors.ListAccessRequests)
                .Locator("[data-testid^=\"access-request-\"]").CountAsync();

        public async Task GroupByUserAsync() =>
            await T(ToolsProjectAssignmentsSelectors.ButtonGroupByUser).ClickAsync();

        public async Task GroupByProjectAsync() =>
            await T(ToolsProjectAssignmentsSelectors.ButtonGroupByProject).ClickAsync();

        public async Task CreateAssignmentAsync(string username, string projectName)
        {
            await T(ToolsProjectAssignmentsSelectors.SelectAssignmentUser)
                .SelectOptionAsync(new SelectOptionValue { Label = username });
            await T(ToolsProjectAssignmentsSelectors.SelectAssignmentProject)
                .SelectOptionAsync(new SelectOptionValue { Label = projectName });
            await T(ToolsProjectAssignmentsSelectors.ButtonCreateAssignment).ClickAsync();
        }
    }

    public sealed class ToolsValidationTracesPage : PageObjectBase, IToolsValidationTracesActions
    {
        public ToolsValidationTracesPage(IPage page) : base(page) { }
        public async Task GotoAsync() =>
            await Page.GotoAsync(MementoSettings.BaseUrl + "/tools/validation-traces");

        public async Task<string> ReadDirectoryAsync() =>
            await T(ToolsValidationTracesSelectors.TextDir).InnerTextAsync();

        public async Task<string> ReadSizeAsync() =>
            await T(ToolsValidationTracesSelectors.TextSize).InnerTextAsync();

        public async Task<string> ReadCountAsync() =>
            await T(ToolsValidationTracesSelectors.TextCount).InnerTextAsync();

        public async Task RefreshAsync() =>
            await T(ToolsValidationTracesSelectors.ButtonRefresh).ClickAsync();
    }

    public sealed class ToolsInternalTestsPage : PageObjectBase, IToolsInternalTestsActions
    {
        public ToolsInternalTestsPage(IPage page) : base(page) { }
        public async Task GotoAsync() =>
            await Page.GotoAsync(MementoSettings.BaseUrl + "/tools/internal-tests");

        public async Task RunSuiteAsync(string suiteId) =>
            await T($"button-internal-tests-run-{suiteId}").ClickAsync();

        public async Task RefreshAsync() =>
            await T(ToolsInternalTestsSelectors.ButtonRefresh).ClickAsync();

        public async Task<bool> IsRunningAsync() =>
            await T(ToolsInternalTestsSelectors.BadgeStatusRunning).IsVisibleAsync();

        public async Task<bool> IsPassedAsync() =>
            await T(ToolsInternalTestsSelectors.BadgeStatusPassed).IsVisibleAsync();

        public async Task<bool> IsFailedAsync() =>
            await T(ToolsInternalTestsSelectors.BadgeStatusFailed).IsVisibleAsync();
    }

    public sealed class ToolsTestRunsPage : PageObjectBase, IToolsTestRunsActions
    {
        public ToolsTestRunsPage(IPage page) : base(page) { }
        public async Task GotoAsync() =>
            await Page.GotoAsync(MementoSettings.BaseUrl + "/tools/test-runs");

        public async Task ClickRunAllAsync() =>
            await T(ToolsTestRunsSelectors.ButtonRunAll).ClickAsync();

        public async Task RefreshAsync() =>
            await T(ToolsTestRunsSelectors.ButtonRefresh).ClickAsync();

        public async Task<bool> IsHistoryEmptyAsync() =>
            await T(ToolsTestRunsSelectors.CardEmpty).IsVisibleAsync();

        public async Task<int> CountHistoryRowsAsync() =>
            await T(ToolsTestRunsSelectors.ListHistory)
                .Locator("[data-testid^=\"row-test-run-\"]").CountAsync();

        public async Task<bool> IsTrendsCardVisibleAsync() =>
            await T(ToolsTestRunsSelectors.CardTrends).IsVisibleAsync();
    }
}
