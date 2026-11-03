namespace Memento.UxTests.Tests.PageObjects.Selectors
{
    public static class ToolsSelectors
    {
        // Tools landing
        public const string CardApproval = "card-tool-approval";
        public const string CardForkRequests = "card-tool-fork-requests";
        public const string CardProjectAssignments = "card-tool-project-assignments";
        public const string CardValidationTraces = "card-tool-validation-traces";
        public const string CardInternalTests = "card-tool-internal-tests";
        public const string CardTestRuns = "card-tool-test-runs";
        public const string CardActivity = "card-tool-activity";
        public const string CardMaintenance = "card-tool-maintenance";
    }

    public static class ToolsApprovalSelectors
    {
        public const string TabAll = "tab-all";
        public const string TabPending = "tab-pending";
        public const string TabApproved = "tab-approved";
        public const string TabRejected = "tab-rejected";
        public const string ApprovalEmpty = "approval-empty";
        public const string ApprovalList = "approval-list";
        public const string DiffFileList = "diff-file-list";
        public const string DiffView = "diff-view";
        public const string DiffViewConflict = "diff-view-conflict";
        public const string ApprovalConflictBanner = "approval-conflict-banner";
        public const string ApprovalSubmitterComment = "approval-submitter-comment";
        public const string ButtonApprove = "button-approve";
        public const string ButtonReject = "button-reject";
        public const string CheckboxAckConflicts = "checkbox-ack-conflicts";
        public const string ButtonDecisionConfirm = "button-decision-confirm";
        public const string ButtonDecisionCancel = "button-decision-cancel";
        public const string InputDecisionComment = "input-decision-comment";
    }

    public static class ToolsForkRequestsSelectors
    {
        public const string SectionForks = "section-forks";
        public const string ListPendingForks = "list-pending-forks";
        public const string ListActiveForks = "list-active-forks";
        public const string SelectForkUser = "select-fork-user";
        public const string SelectForkProject = "select-fork-project";
        public const string ButtonCreateFork = "button-create-fork";
    }

    public static class ToolsProjectAssignmentsSelectors
    {
        public const string SectionAssignments = "section-assignments";
        public const string SectionAccessRequests = "section-access-requests";
        public const string ListAccessRequests = "list-access-requests";
        public const string SelectAssignmentUser = "select-assignment-user";
        public const string SelectAssignmentProject = "select-assignment-project";
        public const string ButtonCreateAssignment = "button-create-assignment";
        public const string ButtonGroupByUser = "button-group-by-user";
        public const string ButtonGroupByProject = "button-group-by-project";
    }

    public static class ToolsValidationTracesSelectors
    {
        public const string CardDisk = "card-validation-traces-disk";
        public const string CardCleanup = "card-validation-traces-cleanup";
        public const string TextDir = "text-validation-traces-dir";
        public const string TextSize = "text-validation-traces-size";
        public const string TextCount = "text-validation-traces-count";
        public const string TextLoading = "text-validation-traces-loading";
        public const string TextError = "text-validation-traces-error";
        public const string ButtonRefresh = "button-validation-traces-refresh";
    }

    public static class ToolsInternalTestsSelectors
    {
        public const string ContainerSuites = "container-internal-tests-suites";
        public const string ButtonRefresh = "button-internal-tests-refresh";
        public const string CardConsole = "card-internal-tests-console";
        public const string CardDisabled = "card-internal-tests-disabled";
        public const string TextConsole = "text-internal-tests-console";
        public const string TextLoading = "text-internal-tests-loading";
        public const string TextOtherRun = "text-internal-tests-other-run";
        public const string BadgeStatusPassed = "badge-internal-tests-status-passed";
        public const string BadgeStatusFailed = "badge-internal-tests-status-failed";
        public const string BadgeStatusRunning = "badge-internal-tests-status-running";
        public const string BadgeStatusError = "badge-internal-tests-status-error";
    }

    public static class ToolsTestRunsSelectors
    {
        public const string ButtonRunAll = "button-test-runs-run-all";
        public const string ButtonRefresh = "button-test-runs-refresh";
        public const string ButtonShowMore = "button-test-runs-show-more";
        public const string CardHistory = "card-test-run-history";
        public const string CardEmpty = "card-test-runs-empty";
        public const string CardTrends = "card-test-run-trends";
        public const string HeadingHistory = "heading-test-run-history";
        public const string HeadingTrends = "heading-test-run-trends";
        public const string ListHistory = "list-test-run-history";
        public const string SparklineRuns = "sparkline-runs";
        public const string TextLoading = "text-test-runs-loading";
        public const string TextError = "text-test-runs-error";
    }
}
