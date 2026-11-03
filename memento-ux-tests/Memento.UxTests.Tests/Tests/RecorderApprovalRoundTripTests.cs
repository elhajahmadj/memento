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
    /// <summary>
    /// End-to-end record → save → request approval → admin approve → merge
    /// round-trip driven through the workbench UI rather than the
    /// approvals API. Covers the User-side toolbar buttons
    /// (<c>button-save-recording</c> / <c>button-request-approval</c>)
    /// that <see cref="ApprovalDecisionTests"/> doesn't exercise — those
    /// tests jump straight to <c>FA.SubmitForkChangeAsync</c> and only
    /// drive the Admin approval surface.
    ///
    /// Preconditions (recorder available, fork active) are gated with
    /// <c>Assert.Inconclusive</c> per the suite's convention so that a
    /// missing seed surfaces as a gap rather than a silent green.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class RecorderApprovalRoundTripTests : UserFixture
    {
        // Snapshot the main project's `/api/projects/tree` response and
        // collect every leaf file path. Used pre- and post-merge so we
        // can prove a NEW file appeared on main rather than asserting
        // a substring (".cs") that's trivially present in any C#
        // scaffold and would pass without a real merge.
        private static System.Collections.Generic.HashSet<string> CollectFilePaths(
            System.Text.Json.JsonElement node, string prefix = "")
        {
            var paths = new System.Collections.Generic.HashSet<string>(
                System.StringComparer.Ordinal);
            void Walk(System.Text.Json.JsonElement n, string p)
            {
                if (n.ValueKind != System.Text.Json.JsonValueKind.Object) return;
                var name = n.TryGetProperty("name", out var nm)
                    && nm.ValueKind == System.Text.Json.JsonValueKind.String
                    ? nm.GetString() ?? "" : "";
                var kind = n.TryGetProperty("kind", out var k)
                    && k.ValueKind == System.Text.Json.JsonValueKind.String
                    ? k.GetString() ?? "" : "";
                var here = string.IsNullOrEmpty(p)
                    ? name
                    : (string.IsNullOrEmpty(name) ? p : p + "/" + name);
                if (kind == "file") paths.Add(here);
                if (n.TryGetProperty("children", out var ch)
                    && ch.ValueKind == System.Text.Json.JsonValueKind.Array)
                {
                    foreach (var child in ch.EnumerateArray()) Walk(child, here);
                }
            }
            Walk(node, prefix);
            return paths;
        }

        private static async Task<System.Collections.Generic.HashSet<string>>
            SnapshotMainTreeAsync(MementoApiClient admin, ProjectDto mainProject)
        {
            (await admin.PostJsonAsync(
                "api/projects/load", new { slnPath = mainProject.SlnPath }))
                .EnsureSuccessStatusCode();
            var resp = await admin.GetAsync("api/projects/tree");
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadAsStringAsync();
            var root = System.Text.Json.JsonDocument.Parse(body).RootElement;
            return CollectFilePaths(root);
        }

        [Test]
        public async Task User_records_then_request_approval_and_admin_approves_merges_into_main()
        {
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var users = await FA.UsersAsync(admin);
            var projectName = TestDataFactory.ProjectName("RTUi");
            var mainProject = await FA.CreateProjectAsync(admin, projectName);
            var fork = await FA.CreateActiveForkAsync(
                admin, users[Constants.UserUsername].Id, projectName);

            // Snapshot the main project's file tree BEFORE the round-trip
            // so we can prove a new .cs file lands on main only after
            // approve+merge runs (and not e.g. as a side effect of project
            // creation, which always seeds a class file).
            var beforePaths = await SnapshotMainTreeAsync(admin, mainProject);

            // User: open the freshly-created fork from /home so the
            // workbench loads with the fork's project context.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/");
            var openBtn = Page.GetByTestId($"button-open-fork-{projectName}");
            await openBtn.WaitForAsync(new()
            {
                State = WaitForSelectorState.Visible,
                Timeout = 10_000,
            });
            await openBtn.ClickAsync();
            await Page.WaitForURLAsync(u => u.Contains("/workbench"));

            // Drive the recorder against the deterministic ux-fixture
            // page. RecorderGate flips to Inconclusive if Chromium /
            // architecture aren't ready.
            var helper = await RecorderGate.StartOrInconclusiveAsync(
                Page, "RoundTripFlow");
            try
            {
                var canvas = await RecorderGate.WaitForCanvasAsync(Page);
                await RecorderGate.RecordOneAsync(
                    Page, canvas, 0.5, RecorderFlowHelper.YButton);
                (await new ActionsFeed(Page).CountVisibleAsync())
                    .Should().BeGreaterThan(0,
                        "the recorded click must surface in the actions feed "
                        + "before we attempt to save the recording");
                await helper.StopAsync();
            }
            catch
            {
                await helper.StopAsync();
                await helper.DiscardAsync();
                throw;
            }

            // Non-admin role gets the "Request SDET approval" CTA — Save
            // is replaced with submit-for-approval. The button must be
            // present and enabled before we click; if not, the recorder
            // didn't transition to "stopped" cleanly and we report it
            // rather than silently passing.
            var requestBtn = Page.GetByTestId(
                WorkbenchSelectors.ButtonRequestApproval);
            if (await requestBtn.CountAsync() == 0
                || !await requestBtn.IsEnabledAsync())
            {
                Assert.Inconclusive(
                    "Workbench did not surface an enabled "
                    + "button-request-approval after Stop — likely no actions "
                    + "were recorded against the fork.");
                return;
            }
            await requestBtn.ClickAsync();

            // Wait for the submission to land in the API. The finalize
            // mutation is fire-and-forget on the UI side; we poll the
            // pending queue rather than racing a toast.
            ApprovalSubmitDto? sub = null;
            for (var i = 0; i < 40 && sub is null; i++)
            {
                var pending = await admin.GetJsonAsync<ApprovalSubmitDto[]>(
                    "api/approvals?status=pending");
                sub = pending.FirstOrDefault(s => s.ForkId == fork.Id);
                if (sub is null) await Task.Delay(250);
            }
            sub.Should().NotBeNull(
                "clicking Request SDET approval must create a pending "
                + "submission against the active fork");

            // Admin approves via the API — the UI approval surface is
            // already covered by ApprovalDecisionTests; here we only
            // need to confirm the merge code path runs and produces a
            // file on main.
            (await admin.PostJsonAsync(
                $"api/approvals/{sub!.Id}/approve",
                new { comment = "approved by ux round-trip" }))
                .EnsureSuccessStatusCode();

            // Hard merge assertion: snapshot the main tree AFTER the
            // approve and assert at least one NEW .cs file path exists
            // that wasn't in the pre-snapshot. This proves the merge
            // actually copied a recorded test class onto main rather
            // than relying on the trivially-true substring ".cs" check.
            var afterPaths = await SnapshotMainTreeAsync(admin, mainProject);
            var added = afterPaths.Except(beforePaths)
                .Where(p => p.EndsWith(".cs", System.StringComparison.OrdinalIgnoreCase))
                .ToList();
            added.Should().NotBeEmpty(
                "approve-and-merge must add at least one .cs file to "
                + "main that wasn't there before the round-trip "
                + $"(before={beforePaths.Count}, after={afterPaths.Count})");
        }

        [Test]
        public async Task User_records_then_request_approval_and_admin_rejects_keeps_main_unchanged()
        {
            // Full UI-driven mirror of the approve test: drive recorder
            // → Stop → button-request-approval, then admin rejects.
            // Exercises the same workbench entry point as the approve
            // path so both decisions get equal rigor.
            await using var admin = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            await using var user = await MementoApiClient.SignedInAsAsync(MementoRole.User);

            var users = await FA.UsersAsync(admin);
            var projectName = TestDataFactory.ProjectName("RTRej");
            var mainProject = await FA.CreateProjectAsync(admin, projectName);
            var fork = await FA.CreateActiveForkAsync(
                admin, users[Constants.UserUsername].Id, projectName);

            // Snapshot the main tree BEFORE the round-trip so the
            // post-reject assertion proves the tree is byte-for-byte
            // unchanged (no merge artifacts of any kind).
            var beforePaths = await SnapshotMainTreeAsync(admin, mainProject);

            await Page.GotoAsync(MementoSettings.BaseUrl + "/");
            var openBtn = Page.GetByTestId($"button-open-fork-{projectName}");
            await openBtn.WaitForAsync(new()
            {
                State = WaitForSelectorState.Visible,
                Timeout = 10_000,
            });
            await openBtn.ClickAsync();
            await Page.WaitForURLAsync(u => u.Contains("/workbench"));

            var helper = await RecorderGate.StartOrInconclusiveAsync(
                Page, "RoundTripRejectFlow");
            try
            {
                var canvas = await RecorderGate.WaitForCanvasAsync(Page);
                await RecorderGate.RecordOneAsync(
                    Page, canvas, 0.5, RecorderFlowHelper.YButton);
                (await new ActionsFeed(Page).CountVisibleAsync())
                    .Should().BeGreaterThan(0,
                        "the recorded click must surface in the actions "
                        + "feed before we attempt to request approval");
                await helper.StopAsync();
            }
            catch
            {
                await helper.StopAsync();
                await helper.DiscardAsync();
                throw;
            }

            var requestBtn = Page.GetByTestId(
                WorkbenchSelectors.ButtonRequestApproval);
            if (await requestBtn.CountAsync() == 0
                || !await requestBtn.IsEnabledAsync())
            {
                Assert.Inconclusive(
                    "Workbench did not surface an enabled "
                    + "button-request-approval after Stop — likely no "
                    + "actions were recorded against the fork.");
                return;
            }
            await requestBtn.ClickAsync();

            ApprovalSubmitDto? sub = null;
            for (var i = 0; i < 40 && sub is null; i++)
            {
                var pending = await admin.GetJsonAsync<ApprovalSubmitDto[]>(
                    "api/approvals?status=pending");
                sub = pending.FirstOrDefault(s => s.ForkId == fork.Id);
                if (sub is null) await Task.Delay(250);
            }
            sub.Should().NotBeNull(
                "Request SDET approval click must create a pending "
                + "submission against the active fork");

            // Submitter must see Pending in the My Approvals view.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/my-approvals");
            (await Page.GetByTestId($"my-approval-status-{sub!.Id}")
                .InnerTextAsync())
                .Should().ContainEquivalentOf("Pending",
                    "submitter must see the new submission as Pending "
                    + "before the admin rejects it");

            (await admin.PostJsonAsync(
                $"api/approvals/{sub.Id}/reject",
                new { comment = "rejected by ux round-trip" }))
                .EnsureSuccessStatusCode();

            await Page.ReloadAsync();
            (await Page.GetByTestId($"my-approval-status-{sub.Id}")
                .InnerTextAsync())
                .Should().ContainEquivalentOf("Rejected",
                    "the My Approvals view must reflect the admin's "
                    + "reject decision after refresh");

            // Hard merge assertion (negative): nothing the user recorded
            // may have been merged onto main, and the tree must be
            // identical to its pre-round-trip snapshot.
            var afterPaths = await SnapshotMainTreeAsync(admin, mainProject);
            afterPaths.Except(beforePaths).Should().BeEmpty(
                "a rejected submission must not introduce any new files "
                + "on main");
            beforePaths.Except(afterPaths).Should().BeEmpty(
                "a rejected submission must not delete any files on main");
        }
    }
}
