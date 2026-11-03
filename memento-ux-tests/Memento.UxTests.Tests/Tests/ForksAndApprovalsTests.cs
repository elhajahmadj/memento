using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Api;
using Memento.UxTests.Infrastructure.Auth;
using Memento.UxTests.Infrastructure.Data;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    internal sealed record AdminUserDto(string Id, string Username, string Role);
    internal sealed record ForkDto(
        string Id, string UserId, string Username,
        string ProjectName, string ForkPath, string Status);
    internal sealed record ApprovalSubmitDto(string Id, string ForkId, string Status);
    internal sealed record AccessRequestDto(
        string Id, string UserId, string Username,
        string ProjectName, string Status);
    internal sealed record ProjectDto(
        string SolutionName, string Namespace, string SlnPath, string RootPath);
    internal sealed record FileContentDto(string Path, string Content);

    internal static class FA
    {
        public static async Task<Dictionary<string, AdminUserDto>> UsersAsync(
            MementoApiClient adminApi)
        {
            var users = await adminApi.GetJsonAsync<AdminUserDto[]>("api/users");
            return users.ToDictionary(u => u.Username, StringComparer.Ordinal);
        }

        public static async Task<ProjectDto> CreateProjectAsync(
            MementoApiClient adminApi, string solutionName)
        {
            return await adminApi.PostJsonAsync<ProjectDto>("api/projects", new
            {
                solutionName,
                testProjectName = solutionName + "Tests",
                @namespace = "Memento.Generated",
                language = "csharp",
            });
        }

        public static async Task<ForkDto> CreateActiveForkAsync(
            MementoApiClient adminApi, string userId, string projectName) =>
            await adminApi.PostJsonAsync<ForkDto>(
                "api/forks", new { userId, projectName });

        public static async Task<ApprovalSubmitDto> SubmitForkChangeAsync(
            MementoApiClient userApi, ForkDto fork,
            string fileRelativePath, string fileContent, string? comment = null)
        {
            var slnPath = fork.ForkPath.TrimEnd('/') + "/" + fork.ProjectName + ".sln";
            (await userApi.PostJsonAsync("api/projects/load", new { slnPath }))
                .EnsureSuccessStatusCode();
            (await userApi.PostJsonAsync("api/files",
                new { path = fileRelativePath, content = fileContent }))
                .EnsureSuccessStatusCode();
            return await userApi.PostJsonAsync<ApprovalSubmitDto>(
                $"api/forks/{fork.Id}/submit",
                new { comment = comment ?? "Submitted by UX test" });
        }

        public static async Task<string?> ReadMainFileAsync(
            MementoApiClient adminApi, ProjectDto mainProject, string relPath)
        {
            (await adminApi.PostJsonAsync(
                "api/projects/load", new { slnPath = mainProject.SlnPath }))
                .EnsureSuccessStatusCode();
            var resp = await adminApi.GetAsync(
                $"api/files?path={Uri.EscapeDataString(relPath)}");
            if (resp.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
            resp.EnsureSuccessStatusCode();
            var dto = await resp.Content.ReadFromJsonOrThrow<FileContentDto>();
            return dto.Content;
        }

        public static async Task AssertAuditEventVisibleAsync(
            IPage page, string projectName, string actionLabel)
        {
            await page.GotoAsync(MementoSettings.BaseUrl + "/settings");
            await page.GetByTestId(SettingsSelectors.SectionActivity)
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });
            await page.GetByTestId(SettingsSelectors.SelectAuditProject).ClickAsync();
            await page.GetByRole(AriaRole.Option, new() { Name = projectName }).ClickAsync();
            await page.GetByTestId(SettingsSelectors.SelectAuditAction).ClickAsync();
            await page.GetByRole(AriaRole.Option, new() { Name = actionLabel }).ClickAsync();
            var rows = await page.Locator("[data-testid^=\"row-audit-\"]").CountAsync();
            rows.Should().BeGreaterThan(0,
                $"audit log should contain a '{actionLabel}' row for {projectName}");
        }
    }

    internal static class HttpJsonExtensions
    {
        public static async Task<T> ReadFromJsonOrThrow<T>(this System.Net.Http.HttpContent content)
        {
            var v = await System.Net.Http.Json.HttpContentJsonExtensions
                .ReadFromJsonAsync<T>(content,
                    new System.Text.Json.JsonSerializerOptions(
                        System.Text.Json.JsonSerializerDefaults.Web));
            if (v is null) throw new InvalidOperationException("null JSON body");
            return v;
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class UserRequestForkUiTests : UserFixture
    {
        [Test]
        public async Task Request_fork_button_transitions_to_awaiting_approval_state()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            var projectName = TestDataFactory.ProjectName("ReqUi");
            await FA.CreateProjectAsync(admin, projectName);

            await Page.GotoAsync(MementoSettings.BaseUrl + "/");

            var requestBtn = Page.GetByTestId($"button-request-fork-{projectName}");
            await requestBtn.WaitForAsync(new() { State = WaitForSelectorState.Visible });
            await requestBtn.ClickAsync();

            await Page.GetByTestId($"button-request-fork-{projectName}")
                .WaitForAsync(new() { State = WaitForSelectorState.Detached });
            await Page.GetByTestId("fork-list").GetByText("Awaiting approval")
                .First.WaitForAsync(new() { State = WaitForSelectorState.Visible });
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ForksRequestApproveDenyTests : AdminFixture
    {
        [Test]
        public async Task User_request_then_admin_approves_via_ui_marks_fork_active()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var projectName = TestDataFactory.ProjectName("Req");
            await FA.CreateProjectAsync(admin, projectName);
            var fork = await user.PostJsonAsync<ForkDto>(
                "api/forks/request", new { projectName });

            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/fork-requests");
            var approveBtn = Page.GetByTestId($"button-approve-{fork.Id}");
            await approveBtn.WaitForAsync(new() { State = WaitForSelectorState.Visible });
            await approveBtn.ClickAsync();

            await Page.GetByTestId($"button-delete-fork-{fork.Id}")
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });
            (await Page.GetByTestId($"button-approve-{fork.Id}").CountAsync())
                .Should().Be(0);

            await FA.AssertAuditEventVisibleAsync(Page, projectName, "Fork created");
        }

        [Test]
        public async Task User_request_then_admin_denies_via_ui_drops_pending_row()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var projectName = TestDataFactory.ProjectName("Deny");
            await FA.CreateProjectAsync(admin, projectName);
            var fork = await user.PostJsonAsync<ForkDto>(
                "api/forks/request", new { projectName });

            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/fork-requests");
            await Page.GetByTestId($"button-deny-{fork.Id}").ClickAsync();
            await Page.GetByTestId($"button-deny-{fork.Id}")
                .WaitForAsync(new() { State = WaitForSelectorState.Detached });
            (await Page.GetByTestId($"button-delete-fork-{fork.Id}").CountAsync())
                .Should().Be(0);
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class UserPostApprovalRoundTripTests : UserFixture
    {
        [Test]
        public async Task User_opens_newly_approved_fork_and_lands_on_workbench()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var users = await FA.UsersAsync(admin);
            var projectName = TestDataFactory.ProjectName("RT");
            await FA.CreateProjectAsync(admin, projectName);

            await FA.CreateActiveForkAsync(
                admin, users[Constants.UserUsername].Id, projectName);

            await Page.GotoAsync(MementoSettings.BaseUrl + "/");
            var openBtn = Page.GetByTestId($"button-open-fork-{projectName}");
            await openBtn.WaitForAsync(new() { State = WaitForSelectorState.Visible });
            await openBtn.ClickAsync();

            await Page.WaitForURLAsync(u => u.Contains("/workbench"));
            await Page.GetByTestId("button-home")
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });
        }

        [Test]
        public async Task Submitter_sees_approved_toast_when_returning_to_home()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var users = await FA.UsersAsync(admin);
            var projectName = TestDataFactory.ProjectName("Notif");
            await FA.CreateProjectAsync(admin, projectName);
            var fork = await FA.CreateActiveForkAsync(
                admin, users[Constants.UserUsername].Id, projectName);
            var sub = await FA.SubmitForkChangeAsync(
                user, fork, $"UxNotes/notif-{TestDataFactory.RunId}.md", "x");
            (await admin.PostJsonAsync(
                $"api/approvals/{sub.Id}/approve", new { comment = "ok" }))
                .EnsureSuccessStatusCode();

            await Page.GotoAsync(MementoSettings.BaseUrl + "/");
            await Page.EvaluateAsync(
                "() => window.localStorage.removeItem('tb.limited.seenApprovalDecisions.v1')");
            await Page.ReloadAsync();

            var expected = $"SDET approved your changes to {projectName}";
            await Page.GetByText(expected)
                .First.WaitForAsync(new()
                {
                    State = WaitForSelectorState.Visible,
                    Timeout = 15_000,
                });
        }

    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ApprovalSubmissionTests : AdminFixture
    {
        [Test]
        public async Task Submit_recording_is_visible_in_admin_queue_and_audit_log()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var users = await FA.UsersAsync(admin);
            var projectName = TestDataFactory.ProjectName("Sub");
            await FA.CreateProjectAsync(admin, projectName);
            var fork = await FA.CreateActiveForkAsync(
                admin, users[Constants.UserUsername].Id, projectName);
            var sub = await FA.SubmitForkChangeAsync(
                user, fork,
                $"UxNotes/{TestDataFactory.RunId}.md", "# UX test note\n",
                "Please review my UX-test note.");

            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/approval");
            await Page.GetByTestId(ToolsApprovalSelectors.TabPending).ClickAsync();
            await Page.GetByTestId($"approval-row-{sub.Id}")
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });

            await FA.AssertAuditEventVisibleAsync(Page, projectName, "Approval submitted");
        }

        [Test]
        public async Task One_pending_submission_per_fork_blocks_a_second_submit()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var users = await FA.UsersAsync(admin);
            var projectName = TestDataFactory.ProjectName("OnePending");
            await FA.CreateProjectAsync(admin, projectName);
            var fork = await FA.CreateActiveForkAsync(
                admin, users[Constants.UserUsername].Id, projectName);
            await FA.SubmitForkChangeAsync(
                user, fork, $"UxNotes/first-{TestDataFactory.RunId}.md", "first");

            var second = await user.PostJsonAsync(
                $"api/forks/{fork.Id}/submit", new { comment = "second" });
            ((int)second.StatusCode).Should().BeInRange(400, 499);
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class OnePendingUiBlockTests : UserFixture
    {
        [Test]
        public async Task Second_submit_attempt_shows_blocked_error_toast_in_ui()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var users = await FA.UsersAsync(admin);
            var projectName = TestDataFactory.ProjectName("OnePendUi");
            await FA.CreateProjectAsync(admin, projectName);
            var fork = await FA.CreateActiveForkAsync(
                admin, users[Constants.UserUsername].Id, projectName);
            await FA.SubmitForkChangeAsync(
                user, fork, $"UxNotes/onep-{TestDataFactory.RunId}.md", "first");

            await Page.GotoAsync(MementoSettings.BaseUrl + "/");
            var submitBtn = Page.GetByTestId($"button-submit-fork-{projectName}");
            await submitBtn.WaitForAsync(new() { State = WaitForSelectorState.Visible });
            await submitBtn.ClickAsync();

            await Page.GetByTestId("textarea-submit-comment")
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });
            await Page.GetByTestId("button-confirm-submit").ClickAsync();

            var anyToast = Page.Locator("[data-sonner-toast]");
            await anyToast.First.WaitForAsync(new()
            {
                State = WaitForSelectorState.Visible,
                Timeout = 10_000,
            });

            var toastsText = string.Join("\n", await anyToast.AllInnerTextsAsync());
            toastsText.Should().NotContain("Submitted for admin approval",
                "the second submit must be blocked, not succeed");
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class MyApprovalsSubmitterTests : UserFixture
    {
        [Test]
        public async Task Submitter_sees_pending_then_approved_in_my_approvals_and_merge_lands_on_main()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var users = await FA.UsersAsync(admin);
            var projectName = TestDataFactory.ProjectName("MyOk");
            var mainProject = await FA.CreateProjectAsync(admin, projectName);
            var fork = await FA.CreateActiveForkAsync(
                admin, users[Constants.UserUsername].Id, projectName);

            var relPath = $"UxNotes/myok-{TestDataFactory.RunId}.md";
            var content = "approved-content-" + TestDataFactory.RunId;
            var sub = await FA.SubmitForkChangeAsync(user, fork, relPath, content);

            await Page.GotoAsync(MementoSettings.BaseUrl + "/my-approvals");
            await Page.GetByTestId($"my-approval-row-{sub.Id}")
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });
            (await Page.GetByTestId($"my-approval-status-{sub.Id}").InnerTextAsync())
                .Should().ContainEquivalentOf("Pending");

            (await admin.PostJsonAsync(
                $"api/approvals/{sub.Id}/approve", new { comment = "merged" }))
                .EnsureSuccessStatusCode();

            await Page.ReloadAsync();
            (await Page.GetByTestId($"my-approval-status-{sub.Id}").InnerTextAsync())
                .Should().ContainEquivalentOf("Approved");

            var onMain = await FA.ReadMainFileAsync(admin, mainProject, relPath);
            onMain.Should().Be(content,
                "approve-and-merge must copy the fork's new file into the main project tree");
        }

        [Test]
        public async Task Submitter_sees_rejected_status_and_main_project_is_unchanged()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var users = await FA.UsersAsync(admin);
            var projectName = TestDataFactory.ProjectName("MyRej");
            var mainProject = await FA.CreateProjectAsync(admin, projectName);
            var fork = await FA.CreateActiveForkAsync(
                admin, users[Constants.UserUsername].Id, projectName);

            var relPath = $"UxNotes/myrej-{TestDataFactory.RunId}.md";
            var sub = await FA.SubmitForkChangeAsync(user, fork, relPath, "to-reject");

            (await admin.PostJsonAsync(
                $"api/approvals/{sub.Id}/reject",
                new { comment = "blocked by UX test" })).EnsureSuccessStatusCode();

            await Page.GotoAsync(MementoSettings.BaseUrl + "/my-approvals");
            (await Page.GetByTestId($"my-approval-status-{sub.Id}").InnerTextAsync())
                .Should().ContainEquivalentOf("Rejected");

            var onMain = await FA.ReadMainFileAsync(admin, mainProject, relPath);
            onMain.Should().BeNull(
                "rejected submissions must not be merged into the main project");
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ApprovalDecisionTests : AdminFixture
    {
        [Test]
        public async Task Approve_and_merge_via_ui_updates_status_audit_and_main_tree()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var users = await FA.UsersAsync(admin);
            var projectName = TestDataFactory.ProjectName("Approve");
            var mainProject = await FA.CreateProjectAsync(admin, projectName);
            var fork = await FA.CreateActiveForkAsync(
                admin, users[Constants.UserUsername].Id, projectName);

            var relPath = $"UxNotes/approve-{TestDataFactory.RunId}.md";
            var content = "approved-via-ui-" + TestDataFactory.RunId;
            var sub = await FA.SubmitForkChangeAsync(user, fork, relPath, content);

            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/approval");
            await Page.GetByTestId(ToolsApprovalSelectors.TabPending).ClickAsync();
            await Page.GetByTestId($"approval-row-{sub.Id}").ClickAsync();
            await Page.GetByTestId(ToolsApprovalSelectors.DiffFileList)
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });

            var fileRow = Page.GetByTestId($"diff-file-{relPath}");
            await fileRow.WaitForAsync(new() { State = WaitForSelectorState.Visible });
            (await fileRow.InnerTextAsync()).Should().Contain("+",
                "an added file must report a positive additions counter in the diff list");

            await Page.GetByTestId(ToolsApprovalSelectors.ButtonApprove).ClickAsync();
            await Page.GetByTestId(ToolsApprovalSelectors.InputDecisionComment)
                .FillAsync("LGTM via UX test");
            await Page.GetByTestId(ToolsApprovalSelectors.ButtonDecisionConfirm).ClickAsync();

            await Page.GetByTestId($"approval-row-{sub.Id}")
                .WaitForAsync(new() { State = WaitForSelectorState.Detached });
            await Page.GetByTestId(ToolsApprovalSelectors.TabApproved).ClickAsync();
            await Page.GetByTestId($"approval-row-{sub.Id}")
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });

            (await FA.ReadMainFileAsync(admin, mainProject, relPath))
                .Should().Be(content);

            await FA.AssertAuditEventVisibleAsync(Page, projectName, "Approval approved");
        }

        [Test]
        public async Task Diff_panel_classifies_added_modified_and_deleted_files()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var users = await FA.UsersAsync(admin);
            var projectName = TestDataFactory.ProjectName("Diff3");
            var mainProject = await FA.CreateProjectAsync(admin, projectName);

            var addedPath = $"UxNotes/added-{TestDataFactory.RunId}.md";
            var modifiedPath = $"UxNotes/mod-{TestDataFactory.RunId}.md";
            var deletedPath = $"UxNotes/del-{TestDataFactory.RunId}.md";

            (await admin.PostJsonAsync(
                "api/projects/load", new { slnPath = mainProject.SlnPath }))
                .EnsureSuccessStatusCode();
            (await admin.PostJsonAsync("api/files",
                new { path = modifiedPath, content = "original\n" }))
                .EnsureSuccessStatusCode();
            (await admin.PostJsonAsync("api/files",
                new { path = deletedPath, content = "doomed\n" }))
                .EnsureSuccessStatusCode();

            var fork = await FA.CreateActiveForkAsync(
                admin, users[Constants.UserUsername].Id, projectName);

            var slnPath = fork.ForkPath.TrimEnd('/') + "/" + fork.ProjectName + ".sln";
            (await user.PostJsonAsync("api/projects/load", new { slnPath }))
                .EnsureSuccessStatusCode();
            (await user.PostJsonAsync("api/files",
                new { path = addedPath, content = "brand new\n" }))
                .EnsureSuccessStatusCode();
            (await user.PutJsonAsync("api/files",
                new { path = modifiedPath, content = "changed by fork\n" }))
                .EnsureSuccessStatusCode();
            (await user.DeleteAsync(
                $"api/files?path={Uri.EscapeDataString(deletedPath)}"))
                .EnsureSuccessStatusCode();
            var sub = await user.PostJsonAsync<ApprovalSubmitDto>(
                $"api/forks/{fork.Id}/submit",
                new { comment = "added/modified/deleted" });

            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/approval");
            await Page.GetByTestId(ToolsApprovalSelectors.TabPending).ClickAsync();
            await Page.GetByTestId($"approval-row-{sub.Id}").ClickAsync();
            await Page.GetByTestId(ToolsApprovalSelectors.DiffFileList)
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });

            var addedRow = Page.GetByTestId($"diff-file-{addedPath}");
            var modifiedRow = Page.GetByTestId($"diff-file-{modifiedPath}");
            var deletedRow = Page.GetByTestId($"diff-file-{deletedPath}");
            await addedRow.WaitForAsync(new() { State = WaitForSelectorState.Visible });
            await modifiedRow.WaitForAsync(new() { State = WaitForSelectorState.Visible });
            await deletedRow.WaitForAsync(new() { State = WaitForSelectorState.Visible });

            var addedText = await addedRow.InnerTextAsync();
            addedText.Should().Contain("+1");
            addedText.Should().Contain("-0");

            var modText = await modifiedRow.InnerTextAsync();
            modText.Should().Contain("+1");
            modText.Should().Contain("-1");

            var delText = await deletedRow.InnerTextAsync();
            delText.Should().Contain("-1");
            delText.Should().Contain("+0");
        }

        [Test]
        public async Task Reject_via_ui_updates_status_audit_and_leaves_main_unchanged()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var users = await FA.UsersAsync(admin);
            var projectName = TestDataFactory.ProjectName("Reject");
            var mainProject = await FA.CreateProjectAsync(admin, projectName);
            var fork = await FA.CreateActiveForkAsync(
                admin, users[Constants.UserUsername].Id, projectName);

            var relPath = $"UxNotes/reject-{TestDataFactory.RunId}.md";
            var sub = await FA.SubmitForkChangeAsync(user, fork, relPath, "to-be-rejected");

            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/approval");
            await Page.GetByTestId(ToolsApprovalSelectors.TabPending).ClickAsync();
            await Page.GetByTestId($"approval-row-{sub.Id}").ClickAsync();
            await Page.GetByTestId(ToolsApprovalSelectors.DiffFileList)
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });

            await Page.GetByTestId(ToolsApprovalSelectors.ButtonReject).ClickAsync();
            await Page.GetByTestId(ToolsApprovalSelectors.InputDecisionComment)
                .FillAsync("Needs more coverage");
            await Page.GetByTestId(ToolsApprovalSelectors.ButtonDecisionConfirm).ClickAsync();

            await Page.GetByTestId(ToolsApprovalSelectors.TabRejected).ClickAsync();
            await Page.GetByTestId($"approval-row-{sub.Id}")
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });

            (await FA.ReadMainFileAsync(admin, mainProject, relPath)).Should().BeNull();

            await FA.AssertAuditEventVisibleAsync(Page, projectName, "Approval rejected");
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class LimitedAdminScopingTests : LimitedAdminFixture
    {
        [Test]
        public async Task Limited_admin_only_sees_assigned_in_queue_and_can_only_act_on_assigned()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);
            await using var limitedApi =
                await MementoApiClient.SignedInAsAsync(MementoRole.LimitedAdmin);

            var users = await FA.UsersAsync(admin);
            var userId = users[Constants.UserUsername].Id;
            var limitedAdminId = users[Constants.LimitedAdminUsername].Id;

            var assigned = TestDataFactory.ProjectName("LAAssigned");
            var unassigned = TestDataFactory.ProjectName("LAUnassigned");
            await FA.CreateProjectAsync(admin, assigned);
            await FA.CreateProjectAsync(admin, unassigned);

            (await admin.PostJsonAsync("api/project-assignments",
                new { userId = limitedAdminId, projectName = assigned }))
                .EnsureSuccessStatusCode();

            var assignedFork = await FA.CreateActiveForkAsync(admin, userId, assigned);
            var unassignedFork = await FA.CreateActiveForkAsync(admin, userId, unassigned);

            var assignedSub = await FA.SubmitForkChangeAsync(
                user, assignedFork,
                $"UxNotes/la-a-{TestDataFactory.RunId}.md", "scoped-in");
            var unassignedSub = await FA.SubmitForkChangeAsync(
                user, unassignedFork,
                $"UxNotes/la-u-{TestDataFactory.RunId}.md", "scoped-out");

            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/approval");
            await Page.GetByTestId(ToolsApprovalSelectors.TabPending).ClickAsync();
            await Page.GetByTestId($"approval-row-{assignedSub.Id}")
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });
            (await Page.GetByTestId($"approval-row-{unassignedSub.Id}").CountAsync())
                .Should().Be(0,
                    "limited admins must not see submissions for unassigned projects");

            var blocked = await limitedApi.PostJsonAsync(
                $"api/approvals/{unassignedSub.Id}/reject",
                new { comment = "should be blocked" });
            ((int)blocked.StatusCode).Should().Be(403,
                "limited admins must not be allowed to reject unassigned submissions");

            var allowed = await limitedApi.PostJsonAsync(
                $"api/approvals/{assignedSub.Id}/approve",
                new { comment = "approved by limited admin" });
            allowed.IsSuccessStatusCode.Should().BeTrue(
                "limited admins must be allowed to approve submissions for assigned projects");
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ProjectAssignmentsLifecycleTests : AdminFixture
    {
        [Test]
        public async Task Approve_access_request_creates_assignment_row()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var limited =
                await MementoApiClient.SignedInAsAsync(MementoRole.LimitedAdmin);

            var projectName = TestDataFactory.ProjectName("AccessReq");
            await FA.CreateProjectAsync(admin, projectName);
            var request = await limited.PostJsonAsync<AccessRequestDto>(
                "api/project-access-requests", new { projectName });

            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/project-assignments");
            await Page.GetByTestId($"button-approve-access-{request.Id}").ClickAsync();
            await Page.GetByTestId(
                $"row-assignment-{Constants.LimitedAdminUsername}-{projectName}")
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });
        }

        [Test]
        public async Task Unassign_with_pending_approval_records_reassignment_audit()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var users = await FA.UsersAsync(admin);
            var userId = users[Constants.UserUsername].Id;
            var limitedAdminId = users[Constants.LimitedAdminUsername].Id;

            var projectName = TestDataFactory.ProjectName("Reassign");
            await FA.CreateProjectAsync(admin, projectName);

            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/project-assignments");
            await Page.GetByTestId(ToolsProjectAssignmentsSelectors.SelectAssignmentUser)
                .ClickAsync();
            await Page.GetByRole(AriaRole.Option,
                new() { Name = Constants.LimitedAdminUsername }).ClickAsync();
            await Page.GetByTestId(ToolsProjectAssignmentsSelectors.SelectAssignmentProject)
                .ClickAsync();
            await Page.GetByRole(AriaRole.Option, new() { Name = projectName }).ClickAsync();
            await Page.GetByTestId(ToolsProjectAssignmentsSelectors.ButtonCreateAssignment)
                .ClickAsync();
            await Page.GetByTestId(
                $"row-assignment-{Constants.LimitedAdminUsername}-{projectName}")
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });

            var fork = await FA.CreateActiveForkAsync(admin, userId, projectName);
            var sub = await FA.SubmitForkChangeAsync(
                user, fork, $"UxNotes/reassign-{TestDataFactory.RunId}.md", "pending");

            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/project-assignments");

            Page.Dialog += async (_, dialog) => await dialog.AcceptAsync();
            var removeBtn = Page.GetByTestId(
                $"button-remove-assignment-{Constants.LimitedAdminUsername}-{projectName}");
            await removeBtn.ClickAsync();
            await removeBtn.WaitForAsync(new() { State = WaitForSelectorState.Detached });

            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/approval");
            await Page.GetByTestId(ToolsApprovalSelectors.TabPending).ClickAsync();
            await Page.GetByTestId($"approval-row-{sub.Id}")
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });

            await Page.GotoAsync(MementoSettings.BaseUrl + "/settings");
            await Page.GetByTestId(SettingsSelectors.SectionActivity)
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });
            await Page.GetByTestId(SettingsSelectors.SelectAuditProject).ClickAsync();
            await Page.GetByRole(AriaRole.Option, new() { Name = projectName }).ClickAsync();

            var rows = Page.Locator("[data-testid^=\"row-audit-\"]");
            (await rows.CountAsync()).Should().BeGreaterThan(0,
                "unassign must record at least one audit event for the project");

            var count = await rows.CountAsync();
            var foundReassignDetail = false;
            for (var i = 0; i < count; i++)
            {
                await rows.Nth(i).ClickAsync();
            }
            var detailBlobs = Page.Locator("[data-testid^=\"details-audit-\"]");
            var blobCount = await detailBlobs.CountAsync();
            for (var i = 0; i < blobCount; i++)
            {
                var text = await detailBlobs.Nth(i).InnerTextAsync();
                if (text.Contains("pending_approval_reassigned") &&
                    text.Contains(sub.Id))
                {
                    foundReassignDetail = true;
                    break;
                }
            }
            foundReassignDetail.Should().BeTrue(
                "audit details should record the pending approval as reassigned away from the unassigned reviewer");
        }
    }
}
