using System.Threading.Tasks;

namespace Memento.UxTests.Tests.PageObjects.Interfaces
{
    public interface IToolsLandingActions
    {
        Task GotoAsync();
        Task<bool> IsCardVisibleAsync(string cardTestId);
    }

    public interface IToolsApprovalActions
    {
        Task GotoAsync();
        Task SwitchToTabAsync(string tabTestId);
        Task<bool> IsEmptyAsync();
        Task<int> CountSubmissionsAsync();
        Task ApproveFirstAsync(string? comment = null);
        Task RejectFirstAsync(string comment);
    }

    public interface IToolsForkRequestsActions
    {
        Task GotoAsync();
        Task<int> CountPendingAsync();
        Task<int> CountActiveAsync();
        Task CreateForkAsync(string username, string projectName);
    }

    public interface IToolsProjectAssignmentsActions
    {
        Task GotoAsync();
        Task<int> CountAccessRequestsAsync();
        Task GroupByUserAsync();
        Task GroupByProjectAsync();
        Task CreateAssignmentAsync(string username, string projectName);
    }

    public interface IToolsValidationTracesActions
    {
        Task GotoAsync();
        Task<string> ReadDirectoryAsync();
        Task<string> ReadSizeAsync();
        Task<string> ReadCountAsync();
        Task RefreshAsync();
    }

    public interface IToolsInternalTestsActions
    {
        Task GotoAsync();
        Task RunSuiteAsync(string suiteId);
        Task RefreshAsync();
        Task<bool> IsRunningAsync();
        Task<bool> IsPassedAsync();
        Task<bool> IsFailedAsync();
    }

    public interface IToolsTestRunsActions
    {
        Task GotoAsync();
        Task ClickRunAllAsync();
        Task RefreshAsync();
        Task<bool> IsHistoryEmptyAsync();
        Task<int> CountHistoryRowsAsync();
        Task<bool> IsTrendsCardVisibleAsync();
    }
}
