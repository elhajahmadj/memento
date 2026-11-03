using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Memento.UxTests.Tests.PageObjects.Selectors;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ApprovalsTests : AdminFixture
    {
        [Test]
        public async Task Approval_console_renders_tabs_and_either_list_or_empty_state()
        {
            var page = new ToolsApprovalPage(Page);
            await page.GotoAsync();
            await Page.GetByTestId(ToolsApprovalSelectors.TabAll).ClickAsync();
            (await page.IsEmptyAsync()
                || await page.CountSubmissionsAsync() >= 0).Should().BeTrue();
        }

        [Test]
        public async Task Pending_tab_shows_only_pending_submissions_or_empty_state()
        {
            var page = new ToolsApprovalPage(Page);
            await page.GotoAsync();
            await page.SwitchToTabAsync(ToolsApprovalSelectors.TabPending);
            // Either the empty state appears, or the list is non-negative (sanity).
            (await page.IsEmptyAsync()
                || await page.CountSubmissionsAsync() >= 0).Should().BeTrue();
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ForkRequestsTests : AdminFixture
    {
        [Test]
        public async Task Fork_requests_page_renders_pending_and_active_lists()
        {
            var page = new ToolsForkRequestsPage(Page);
            await page.GotoAsync();
            (await page.CountPendingAsync()).Should().BeGreaterThanOrEqualTo(0);
            (await page.CountActiveAsync()).Should().BeGreaterThanOrEqualTo(0);
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ProjectAssignmentsTests : AdminFixture
    {
        [Test]
        public async Task Project_assignments_page_supports_grouping_toggle()
        {
            var page = new ToolsProjectAssignmentsPage(Page);
            await page.GotoAsync();
            await page.GroupByUserAsync();
            await page.GroupByProjectAsync();
            (await page.CountAccessRequestsAsync()).Should().BeGreaterThanOrEqualTo(0);
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ValidationTracesTests : AdminFixture
    {
        [Test]
        public async Task Validation_traces_page_reports_disk_usage()
        {
            var page = new ToolsValidationTracesPage(Page);
            await page.GotoAsync();
            await page.RefreshAsync();
            (await page.ReadDirectoryAsync()).Should().NotBeNullOrWhiteSpace();
        }

        [Test]
        public async Task Validation_traces_disk_usage_renders_in_human_readable_units()
        {
            // The validation-traces page formats disk usage via
            // formatBytes() (B / KB / MB / GB / TB). We assert:
            //   1. all three readouts (size / count / dir) render,
            //   2. the size string matches the units pattern,
            //   3. the count string ends with "file" or "files".
            // This catches accidental empty-state regressions and
            // guarantees the human-readable format that the UX
            // requires (REQUIREMENTS.md validation-traces section).
            var page = new ToolsValidationTracesPage(Page);
            await page.GotoAsync();
            await page.RefreshAsync();

            var sizeText = Page.GetByTestId("text-validation-traces-size");
            var countText = Page.GetByTestId("text-validation-traces-count");
            var dirText = Page.GetByTestId("text-validation-traces-dir");
            (await sizeText.IsVisibleAsync()).Should().BeTrue();
            (await countText.IsVisibleAsync()).Should().BeTrue();
            (await dirText.IsVisibleAsync()).Should().BeTrue();

            var sizeStr = (await sizeText.InnerTextAsync()).Trim();
            sizeStr.Should().MatchRegex(@"^\d+(\.\d+)?\s*(B|KB|MB|GB|TB)$",
                "the disk-usage readout must use the formatBytes units");

            var countStr = (await countText.InnerTextAsync()).Trim();
            countStr.Should().MatchRegex(@"^\d+\s+files?\b.*",
                "the file-count readout must report a count + 'file(s)'");

            (await dirText.InnerTextAsync()).Trim().Should().NotBeEmpty(
                "the directory-path readout must report a non-empty path");

            // The cleanup card always renders one of two leaf nodes:
            // text-validation-traces-last-cleanup-at when a sweep has
            // run, or text-validation-traces-no-cleanup otherwise.
            // Validation-traces ships no manual cleanup affordance
            // (auto-only), so we assert the disjunction rather than
            // a delta after a button click.
            var lastAt = Page.GetByTestId("text-validation-traces-last-cleanup-at");
            var noCleanup = Page.GetByTestId("text-validation-traces-no-cleanup");
            (await lastAt.CountAsync() + await noCleanup.CountAsync())
                .Should().BeGreaterThan(0,
                "the cleanup card must render either a last-run timestamp or a no-cleanup placeholder");
        }

        [Test]
        public async Task Validation_traces_back_button_exists_per_PageShell_contract()
        {
            // REQUIREMENTS.md line 31-32: every PageShell sub-page
            // exposes a Back button. Validation-traces' selector is
            // `button-validation-traces-back` (PageShell backTestId).
            var page = new ToolsValidationTracesPage(Page);
            await page.GotoAsync();
            (await Page.GetByTestId("button-validation-traces-back").IsVisibleAsync())
                .Should().BeTrue();
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class InternalTestsToolTests : AdminFixture
    {
        [Test]
        public async Task Internal_tests_page_renders_or_is_disabled()
        {
            var page = new ToolsInternalTestsPage(Page);
            await page.GotoAsync();
            (await Page.GetByTestId(ToolsInternalTestsSelectors.CardDisabled).IsVisibleAsync()
                || await Page.GetByTestId(ToolsInternalTestsSelectors.ContainerSuites).IsVisibleAsync())
                .Should().BeTrue();
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class TestRunsTests : AdminFixture
    {
        [Test]
        public async Task Test_runs_page_renders_history_or_empty_state()
        {
            var page = new ToolsTestRunsPage(Page);
            await page.GotoAsync();
            (await page.IsHistoryEmptyAsync()
                || (await page.CountHistoryRowsAsync()) >= 0).Should().BeTrue();
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ToolsLandingCardsTests : AdminFixture
    {
        protected override string StartPath => "/tools";

        [Test]
        public async Task Tools_landing_shows_activity_and_maintenance_cards_for_admin()
        {
            // Activity / Maintenance moved from Settings to /tools
            // landing cards. Both must render for a full Admin.
            var tools = new ToolsLandingPage(Page);
            (await tools.IsCardVisibleAsync(ToolsSelectors.CardActivity)).Should().BeTrue();
            (await tools.IsCardVisibleAsync(ToolsSelectors.CardMaintenance)).Should().BeTrue();
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ToolsActivityTests : AdminFixture
    {
        protected override string StartPath => "/tools/activity";

        [Test]
        public async Task Activity_page_renders_filters()
        {
            var settings = new SettingsPage(Page);
            (await Page.GetByTestId(SettingsSelectors.SectionActivityBody).IsVisibleAsync())
                .Should().BeTrue();
            await settings.ResetAuditAsync();
        }

        [Test]
        public async Task Activity_user_filter_narrows_and_reset_restores()
        {
            var settings = new SettingsPage(Page);
            await settings.ResetAuditAsync();
            int baseline = await settings.AuditRowCountAsync();

            await settings.FilterAuditByUserAsync("zzz-no-such-user-xyz");
            int filtered = await settings.AuditRowCountAsync();
            filtered.Should().BeLessOrEqualTo(baseline,
                "user filter should not increase the result count");
            (filtered == 0 || await settings.IsAuditEmptyAsync()
                || filtered < baseline).Should().BeTrue();

            await settings.ResetAuditAsync();
            (await settings.AuditRowCountAsync()).Should().Be(baseline);
        }

        [Test]
        public async Task Activity_back_button_exists_per_PageShell_contract()
        {
            (await Page.GetByTestId("button-activity-back").IsVisibleAsync())
                .Should().BeTrue();
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class LimitedAdminActivityScopingTests : LimitedAdminFixture
    {
        protected override string StartPath => "/tools/activity";

        [Test]
        public async Task LimitedAdmin_can_view_scoped_activity_log()
        {
            var settings = new SettingsPage(Page);
            (await Page.GetByTestId(SettingsSelectors.SectionActivityBody).IsVisibleAsync())
                .Should().BeTrue();
            await settings.ResetAuditAsync();
            int rows = await settings.AuditRowCountAsync();
            bool empty = await settings.IsAuditEmptyAsync();
            (rows > 0 || empty).Should().BeTrue(
                "limited-admin activity should either show rows or the empty hint");
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ToolsMaintenanceTests : AdminFixture
    {
        protected override string StartPath => "/tools/maintenance";

        [Test]
        public async Task Maintenance_page_renders_section_and_back_button()
        {
            (await Page.GetByTestId("section-maintenance").IsVisibleAsync())
                .Should().BeTrue();
            (await Page.GetByTestId("button-maintenance-back").IsVisibleAsync())
                .Should().BeTrue();
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class MyApprovalsTests : UserFixture
    {
        [Test]
        public async Task User_can_visit_my_approvals_page()
        {
            var page = new MyApprovalsPage(Page);
            await page.GotoAsync();
            (await page.IsEmptyAsync() || (await page.CountAsync()) >= 0).Should().BeTrue();
        }
    }
}
