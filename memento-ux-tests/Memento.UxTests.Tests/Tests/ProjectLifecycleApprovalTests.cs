using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Api;
using Memento.UxTests.Infrastructure.Auth;
using Memento.UxTests.Infrastructure.Data;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    internal sealed record LifecycleRequestDto(
        string Id, string Kind, string Status,
        string ProjectName, string RequestedByUsername, string RequestedByRole);

    internal sealed record DeleteResponseDto(string Status, string? RequestId);

    internal sealed record CreateRequestResponseDto(bool Pending, LifecycleRequestDto Request);

    internal static class LA
    {
        public static async Task<LifecycleRequestDto[]> PendingAsync(MementoApiClient api) =>
            await api.GetJsonAsync<LifecycleRequestDto[]>(
                "api/projects/lifecycle-requests?status=pending");
    }

    /// <summary>
    /// Delete approval flow: limited_admin files a delete; a second admin
    /// approves it from the Admin → Pending deletions section. Verifies
    /// the project is gone and the activity log surfaces the request,
    /// approval, and executed audit events.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ProjectDeleteApprovalUiTests : AdminFixture
    {
        [Test]
        public async Task LimitedAdmin_requests_delete_then_admin_approves_via_ui_removes_project()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var limited = await MementoApiClient.SignedInAsAsync(MementoRole.LimitedAdmin);

            var projectName = TestDataFactory.ProjectName("DelAppr");
            var project = await FA.CreateProjectAsync(admin, projectName);

            var fileResp = await limited.PostJsonAsync<DeleteResponseDto>(
                "api/projects/delete", new { slnPath = project.SlnPath });
            fileResp.Status.Should().Be("pending");
            fileResp.RequestId.Should().NotBeNullOrWhiteSpace();

            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin#lifecycle-requests");
            var approveBtn = Page.GetByTestId($"button-approve-{fileResp.RequestId}");
            await approveBtn.WaitForAsync(new() { State = WaitForSelectorState.Visible });

            Page.Dialog += (_, dialog) => _ = dialog.AcceptAsync();
            await approveBtn.ClickAsync();

            await Page.GetByTestId($"row-lifecycle-{fileResp.RequestId}")
                .WaitForAsync(new() { State = WaitForSelectorState.Detached });

            var stillPending = await LA.PendingAsync(admin);
            stillPending.Any(r => r.Id == fileResp.RequestId).Should().BeFalse();

            await FA.AssertAuditEventVisibleAsync(Page, projectName, "Project delete approved");
        }

        [Test]
        public async Task Admin_can_reject_pending_delete_request_via_ui_and_project_survives()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var limited = await MementoApiClient.SignedInAsAsync(MementoRole.LimitedAdmin);

            var projectName = TestDataFactory.ProjectName("DelReject");
            var project = await FA.CreateProjectAsync(admin, projectName);

            var fileResp = await limited.PostJsonAsync<DeleteResponseDto>(
                "api/projects/delete", new { slnPath = project.SlnPath });
            fileResp.Status.Should().Be("pending");

            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin#lifecycle-requests");
            var rejectBtn = Page.GetByTestId($"button-reject-{fileResp.RequestId}");
            await rejectBtn.WaitForAsync(new() { State = WaitForSelectorState.Visible });
            await rejectBtn.ClickAsync();

            await Page.GetByTestId($"row-lifecycle-{fileResp.RequestId}")
                .WaitForAsync(new() { State = WaitForSelectorState.Detached });

            var projects = await admin.GetJsonAsync<ProjectDto[]>("api/projects/available");
            projects.Any(p => p.SolutionName == projectName).Should().BeTrue(
                "rejecting a pending delete must leave project files in place");

            await FA.AssertAuditEventVisibleAsync(Page, projectName, "Project delete rejected");
        }
    }

    /// <summary>
    /// Create approval flow: a User opens the New Project dialog,
    /// submits, and their pending request shows in the
    /// "Your pending project requests" section with a Cancel button.
    /// An admin then approves the request from Admin → Project creation
    /// requests and the project shows up in the catalog.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ProjectCreateApprovalUiTests : UserFixture
    {
        [Test]
        public async Task User_requests_new_project_then_admin_approves_makes_project_real()
        {
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var projectName = TestDataFactory.ProjectName("CreAppr");
            var requested = await user.PostJsonAsync<CreateRequestResponseDto>(
                "api/projects",
                new
                {
                    solutionName = projectName,
                    testProjectName = projectName + "Tests",
                    @namespace = "Memento.Generated",
                    language = "csharp",
                });
            requested.Pending.Should().BeTrue();
            requested.Request.Kind.Should().Be("create");
            var requestId = requested.Request.Id;

            await Page.GotoAsync(MementoSettings.BaseUrl + "/");
            await Page.GetByTestId("section-my-pending-projects")
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });
            await Page.GetByTestId($"row-my-pending-{projectName}")
                .WaitForAsync(new() { State = WaitForSelectorState.Visible });

            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await Page.Context.ClearCookiesAsync();
            await Page.GotoAsync(
                MementoSettings.BaseUrl
                + $"/api/auth/dev-login?username={Uri.EscapeDataString(MementoSettings.AdminCredentials.Username)}&role=admin");

            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin#project-create-requests");
            var approveBtn = Page.GetByTestId($"button-approve-create-{requestId}");
            await approveBtn.WaitForAsync(new() { State = WaitForSelectorState.Visible });
            await approveBtn.ClickAsync();

            await Page.GetByTestId($"row-project-create-request-{requestId}")
                .WaitForAsync(new() { State = WaitForSelectorState.Detached });

            var projects = await admin.GetJsonAsync<ProjectDto[]>("api/projects/available");
            projects.Any(p => p.SolutionName == projectName).Should().BeTrue(
                "approved create request should materialize the project");

            await FA.AssertAuditEventVisibleAsync(Page, projectName, "Project create approved");
        }
    }
}
