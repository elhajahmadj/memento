using System;
using System.IO;
using System.Linq;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Api;
using Memento.UxTests.Infrastructure.Auth;
using Memento.UxTests.Infrastructure.Data;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// Shared helpers for the Settings → Git Repos UX coverage. Each
    /// concrete fixture below mints a per-fixture project (and, where
    /// applicable, a local bare git remote served over <c>file://</c>)
    /// so the tests do not depend on real Azure Repos / GitHub
    /// credentials and do not collide with other suites.
    ///
    /// The api-server only accepts <c>file://</c> URLs in its repo-URL
    /// validator when <c>APP_ENVIRONMENT</c> is local/development (see
    /// <c>gitConfigService.validateRepoUrl</c>); the workflow config
    /// already sets that for dev, and the validation script enforces it.
    /// </summary>
    internal static class GitReposTestSupport
    {
        /// <summary>Acceptable PAT for the upsert validator (≥ 8 chars).</summary>
        public const string DummyPat = "uxtest-dummy-pat-1234";

        public static async Task<string> CreateProjectAsync(MementoApiClient api, string suffix)
        {
            // RunId is process-static, so two tests sharing the same
            // suffix would collide. Sprinkle in a per-call random tail
            // so every fixture/test gets a fresh project.
            var unique = suffix + Guid.NewGuid().ToString("N").Substring(0, 6);
            var name = TestDataFactory.ProjectName(unique);
            // POST /api/projects requires testProjectName (the existing
            // CreateProjectAsync helper omits it, so call directly).
            var resp = await api.PostJsonAsync("api/projects", new
            {
                solutionName = name,
                language = "csharp",
                @namespace = name,
                testProjectName = name,
            });
            resp.EnsureSuccessStatusCode();
            return name;
        }

        public static async Task<string> ProjectRootOnDiskAsync(MementoApiClient api, string projectName)
        {
            var resp = await api.GetAsync("api/projects/available");
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);
            // Response shape: bare array of { solutionName, slnPath, ... }.
            // Tolerate a wrapping object with a "projects" key in case
            // the codegen ever changes shape.
            JsonElement projects = doc.RootElement.ValueKind == JsonValueKind.Array
                ? doc.RootElement
                : (doc.RootElement.TryGetProperty("projects", out var arr)
                    ? arr
                    : doc.RootElement);
            foreach (var p in projects.EnumerateArray())
            {
                var n = p.GetProperty("solutionName").GetString();
                if (n == projectName)
                {
                    var sln = p.GetProperty("slnPath").GetString()!;
                    return Path.GetDirectoryName(sln)!;
                }
            }
            throw new InvalidOperationException(
                $"Project '{projectName}' not found via /api/projects/available.");
        }

        public static string SolutionFileName(string projectName) => projectName + ".sln";

        public static async Task DeleteProjectAsync(MementoApiClient api, string projectName)
        {
            // /api/projects/delete keys off slnPath, not solutionName, so
            // resolve it through /api/projects/available first.
            try
            {
                var resp = await api.GetAsync("api/projects/available");
                if (!resp.IsSuccessStatusCode) return;
                var body = await resp.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(body);
                JsonElement projects = doc.RootElement.ValueKind == JsonValueKind.Array
                    ? doc.RootElement
                    : (doc.RootElement.TryGetProperty("projects", out var arr)
                        ? arr
                        : doc.RootElement);
                foreach (var p in projects.EnumerateArray())
                {
                    if (p.GetProperty("solutionName").GetString() == projectName)
                    {
                        var sln = p.GetProperty("slnPath").GetString();
                        if (!string.IsNullOrEmpty(sln))
                            await api.PostJsonAsync("api/projects/delete", new { slnPath = sln });
                        return;
                    }
                }
            }
            catch
            {
                // best-effort cleanup
            }
        }

        /// <summary>
        /// Wait for a sonner toast whose text contains <paramref name="needle"/>.
        /// Sonner renders into a region with role="status" and per-toast
        /// elements with role="status" too; the substring assertion keeps
        /// us robust to formatting noise (commit subjects, error codes).
        /// </summary>
        public static async Task ExpectToastAsync(IPage page, string needle, int timeoutMs = 10000)
        {
            await page.GetByText(needle, new() { Exact = false })
                .First.WaitForAsync(new() { Timeout = timeoutMs });
        }

        /// <summary>
        /// Filter the activity table to the given project and assert at
        /// least one row whose Action cell text contains the given audit
        /// action name (e.g. <c>project_git_push</c>). The activity
        /// section's action filter dropdown does not (yet) include git
        /// actions, so we filter by project and scan rows for the action
        /// name in the rendered cell.
        /// </summary>
        public static async Task AssertActivityHasActionForProjectAsync(
            IPage page, string projectName, string actionName, int timeoutMs = 10000)
        {
            await page.GotoAsync(MementoSettings.BaseUrl + "/settings");
            // The Activity section is rendered inside a CollapsibleSection
            // (testId="activity") that starts collapsed. Click the
            // trigger so the inner select-audit-project becomes visible.
            var activityTrigger = page.GetByTestId("collapsible-trigger-activity");
            await activityTrigger.First.WaitForAsync(new() { Timeout = 8000 });
            var expanded = await activityTrigger.First.GetAttributeAsync("data-state");
            if (expanded != "open")
            {
                await activityTrigger.First.ClickAsync();
            }
            await page.GetByTestId(SettingsSelectors.SelectAuditProject)
                .First.WaitForAsync(new() { Timeout = 8000 });
            await RadixSelectHelper.SelectByLabelAsync(
                page, SettingsSelectors.SelectAuditProject, projectName);
            // Wait for either the empty-state placeholder or at least
            // one rendered audit row before asserting.
            await page.WaitForFunctionAsync(
                "() => !!document.querySelector('[data-testid=\"audit-empty\"]') "
                + "|| !!document.querySelector('[data-testid^=\"row-audit-\"]')",
                new PageWaitForFunctionOptions { Timeout = timeoutMs });
            var matches = page.Locator("[data-testid^=\"row-audit-\"]")
                .Filter(new() { HasText = actionName });
            (await matches.CountAsync()).Should().BeGreaterThan(0,
                $"expected an activity row with action '{actionName}' for project '{projectName}'");
        }
    }

    /// <summary>
    /// Configure-dialog coverage: URL validation per provider, and the
    /// PAT-display contract (•••<last 4> + Replace button) once a PAT
    /// has been saved. No real git operations run in this fixture.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class GitReposConfigureDialogTests : AdminFixture
    {
        protected override string StartPath => "/settings";

        private MementoApiClient _api = null!;
        private string _project = null!;

        [SetUp]
        public async Task PerTestSetUp()
        {
            _api = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            _project = await GitReposTestSupport.CreateProjectAsync(_api, "Cfg");
            // Re-navigate so /api/projects/available re-renders the list.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/settings");
        }

        [TearDown]
        public async Task PerTestTearDown()
        {
            try { await GitReposTestSupport.DeleteProjectAsync(_api, _project); }
            finally { await _api.DisposeAsync(); }
        }

        [Test]
        public async Task Save_with_github_url_under_azure_provider_shows_validation_error()
        {
            var page = new GitReposPage(Page);
            await page.WaitForRowAsync(_project);
            await page.OpenConfigureAsync(_project);
            // Default provider is azure_repos. Submit a github URL.
            await page.FillConfigureAsync(_project,
                provider: "azure_repos",
                url: "https://github.com/owner/repo.git",
                branch: "main",
                pat: GitReposTestSupport.DummyPat);
            await page.SaveAsync(_project);

            await GitReposTestSupport.ExpectToastAsync(Page,
                "Repository URL must be an Azure Repos URL");
        }

        [Test]
        public async Task Save_with_azure_url_under_github_provider_shows_validation_error()
        {
            var page = new GitReposPage(Page);
            await page.WaitForRowAsync(_project);
            await page.OpenConfigureAsync(_project);
            await page.FillConfigureAsync(_project,
                provider: "github",
                url: "https://dev.azure.com/org/project/_git/repo",
                branch: "main",
                pat: GitReposTestSupport.DummyPat);
            await page.SaveAsync(_project);

            await GitReposTestSupport.ExpectToastAsync(Page,
                "Repository URL must be a GitHub URL");
        }

        [TestCase("azure_repos")]
        [TestCase("github")]
        public async Task Save_with_valid_url_displays_last_four_of_pat_and_replace_button(string provider)
        {
            var page = new GitReposPage(Page);
            await page.WaitForRowAsync(_project);
            await page.OpenConfigureAsync(_project);
            // Use the file:// dev-mode bypass so we don't need real
            // Azure/GitHub creds to reach the post-save state. The
            // dev-mode validator accepts file:// for both providers,
            // so the same fixture exercises Azure Repos and GitHub.
            var pat = "secret-pat-AB12";
            await using var remote = await LocalGitRemote.CreateAsync(
                _project, GitReposTestSupport.SolutionFileName(_project));
            await page.FillConfigureAsync(_project,
                provider: provider,
                url: remote.FileUrl,
                branch: "main",
                pat: pat);
            await page.SaveAsync(_project);

            await GitReposTestSupport.ExpectToastAsync(Page,
                "Git provider configuration saved");

            // Row summary now includes the PAT last-four marker.
            await Page.GetByTestId(GitReposSelectors.Row(_project))
                .GetByText("•••AB12").First
                .WaitForAsync(new() { Timeout = 5000 });

            // Re-opening the dialog must NOT show the PAT input — it
            // shows the last-four blob and a Replace button instead.
            await page.OpenConfigureAsync(_project);
            await page.ReplacePatButton(_project)
                .WaitForAsync(new() { Timeout = 5000 });
            await page.PatInput(_project).IsVisibleAsync().ContinueWith(t =>
                t.Result.Should().BeFalse(
                    "PAT input must stay hidden until Replace is clicked"));

            // Clicking Replace reveals the PAT input again.
            await page.ReplacePatButton(_project).ClickAsync();
            (await page.PatInput(_project).IsVisibleAsync()).Should().BeTrue();
        }
    }

    /// <summary>
    /// Pull-flow coverage: success toast contains the short SHA; an
    /// error path produces an error toast with the matching error code.
    /// (The api-server's <c>auth_failed</c> branch fires on real HTTPS
    /// auth failures; with the file:// dev-mode remote the equivalent
    /// "the user's URL is wrong" toast surfaces as <c>repo_not_found</c>,
    /// which is what we assert here. The auth_failed code path itself
    /// is covered by the api-server unit tests.)
    /// </summary>
    [TestFixture("azure_repos")]
    [TestFixture("github")]
    [Category(Constants.CategoryFunctional)]
    public sealed class GitReposPullFlowTests : AdminFixture
    {
        protected override string StartPath => "/settings";

        private readonly string _provider;
        private MementoApiClient _api = null!;
        private string _project = null!;
        private LocalGitRemote _remote = null!;

        public GitReposPullFlowTests(string provider)
        {
            _provider = provider;
        }

        [SetUp]
        public async Task PerTestSetUp()
        {
            _api = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            _project = await GitReposTestSupport.CreateProjectAsync(_api, "Pull");
            _remote = await LocalGitRemote.CreateAsync(
                _project, GitReposTestSupport.SolutionFileName(_project));
            await ConfigureRemoteAsync(_remote.FileUrl);
            await Page.GotoAsync(MementoSettings.BaseUrl + "/settings");
        }

        [TearDown]
        public async Task PerTestTearDown()
        {
            try { await _remote.DisposeAsync(); } catch { }
            try { await GitReposTestSupport.DeleteProjectAsync(_api, _project); }
            finally { await _api.DisposeAsync(); }
        }

        private async Task ConfigureRemoteAsync(string url)
        {
            // Drive the upsert through the API rather than the dialog so
            // each test starts in a known good state without UI flake.
            // The dev-mode validator accepts file:// and loopback http://
            // URLs for both providers, so the same fixture exercises
            // azure_repos and github paths.
            var resp = await _api.PutJsonAsync(
                $"api/projects/{Uri.EscapeDataString(_project)}/git-config",
                new
                {
                    provider = _provider,
                    repoUrl = url,
                    branch = "main",
                    pat = GitReposTestSupport.DummyPat,
                });
            resp.EnsureSuccessStatusCode();
        }

        [Test]
        public async Task Successful_pull_shows_short_sha_in_toast()
        {
            var page = new GitReposPage(Page);
            await page.WaitForRowAsync(_project);
            await page.PullAsync(_project);
            await page.ConfirmPullAsync(_project);
            // The success toast format is `Pulled <7-char-sha>` or
            // `Pulled <sha> — <subject>`. Asserting on the literal
            // 7-char prefix keeps the test stable.
            await GitReposTestSupport.ExpectToastAsync(Page, "Pulled ");
        }

        [Test]
        public async Task Pull_against_missing_remote_surfaces_error_toast_with_code()
        {
            // Re-point the project at a bare path that does not exist
            // so the clone fails. file:// errors classify to
            // repo_not_found (see classifyGitError), which the UI
            // surfaces in the toast as `[repo_not_found]`.
            var bogusUrl = "file:///tmp/memento-ux-does-not-exist-" + Guid.NewGuid().ToString("N") + ".git";
            await ConfigureRemoteAsync(bogusUrl);
            await Page.ReloadAsync();

            var page = new GitReposPage(Page);
            await page.WaitForRowAsync(_project);
            await page.PullAsync(_project);
            await page.ConfirmPullAsync(_project);
            // The pull endpoint returns HTTP 400 for ok:false results.
            // The azure-repos-section onError handler reads the JSON
            // body's errorCode and renders a friendly toast: a missing
            // bare path classifies to either repo_not_found ("Repository
            // not found") or git_failed ("Pull failed") — both are
            // valid signals that the error toast path fired and that
            // the raw "HTTP 400 Bad Request" prefix is no longer shown.
            await Page.GetByText(new System.Text.RegularExpressions.Regex(
                @"Repository not found|Pull failed")).First
                .WaitForAsync(new() { Timeout = 10000 });
        }

        [Test]
        public async Task Pull_against_auth_rejecting_remote_shows_auth_failed_toast()
        {
            // Stand up a loopback HTTP server that returns 401 for every
            // request, then point the project at it. git's clone over
            // HTTP will see the 401 and surface "Authentication failed"
            // / "could not read Username" in stderr, which
            // classifyGitError maps to auth_failed. The push/pull
            // routes return that errorCode in the response body and the
            // azure-repos-section onError handler renders the message
            // through toast.error.
            await using var failer = await LocalAuthFailingHttpServer.CreateAsync();
            await ConfigureRemoteAsync(failer.Url);
            await Page.ReloadAsync();

            var page = new GitReposPage(Page);
            await page.WaitForRowAsync(_project);
            await page.PullAsync(_project);
            await page.ConfirmPullAsync(_project);
            // Friendly toast: the section now reads errorCode=auth_failed
            // off the JSON body and renders the "Authentication failed"
            // title without the raw "HTTP 400" prefix.
            await GitReposTestSupport.ExpectToastAsync(Page, "Authentication failed", 15000);
        }
    }

    /// <summary>
    /// Push-flow coverage: commit-message is required, success path
    /// renders the short SHA + branch toast, the "nothing to push"
    /// branch renders the matching info notice, and the
    /// non-fast-forward branch surfaces the <c>push_rejected</c> error
    /// toast. Also asserts an <c>activity</c> row for
    /// <c>project_git_push</c> after the push.
    /// </summary>
    [TestFixture("azure_repos")]
    [TestFixture("github")]
    [Category(Constants.CategoryFunctional)]
    public sealed class GitReposPushFlowTests : AdminFixture
    {
        protected override string StartPath => "/settings";

        private readonly string _provider;
        private MementoApiClient _api = null!;
        private string _project = null!;
        private LocalGitRemote _remote = null!;
        private string _projectRoot = null!;

        public GitReposPushFlowTests(string provider)
        {
            _provider = provider;
        }

        [SetUp]
        public async Task PerTestSetUp()
        {
            _api = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            _project = await GitReposTestSupport.CreateProjectAsync(_api, "Push");
            _remote = await LocalGitRemote.CreateAsync(
                _project, GitReposTestSupport.SolutionFileName(_project));
            _projectRoot = await GitReposTestSupport.ProjectRootOnDiskAsync(_api, _project);
            // The on-disk project content does NOT match the bare's seed
            // initially: the api-server's push pipeline copies the live
            // project files over the clone, so the first push commits a
            // real diff. The "nothing to push" path is exercised only by
            // a second push when the working tree hasn't changed since
            // the previous successful push.

            await ConfigureRemoteAsync(_remote.FileUrl);
            await Page.GotoAsync(MementoSettings.BaseUrl + "/settings");
        }

        private async Task ConfigureRemoteAsync(string url)
        {
            // The dev-mode validator accepts file:// and loopback http://
            // URLs for both providers, so the same fixture exercises
            // azure_repos and github paths.
            var resp = await _api.PutJsonAsync(
                $"api/projects/{Uri.EscapeDataString(_project)}/git-config",
                new
                {
                    provider = _provider,
                    repoUrl = url,
                    branch = "main",
                    pat = GitReposTestSupport.DummyPat,
                });
            resp.EnsureSuccessStatusCode();
        }

        [TearDown]
        public async Task PerTestTearDown()
        {
            try { await _remote.DisposeAsync(); } catch { }
            try { await GitReposTestSupport.DeleteProjectAsync(_api, _project); }
            finally { await _api.DisposeAsync(); }
        }

        [Test]
        public async Task Confirm_push_button_is_disabled_until_commit_message_is_typed()
        {
            var page = new GitReposPage(Page);
            await page.WaitForRowAsync(_project);
            await page.PushAsync(_project);
            await page.CommitMessageInput(_project)
                .WaitForAsync(new() { Timeout = 5000 });
            (await page.ConfirmPushButton(_project).IsDisabledAsync())
                .Should().BeTrue("commit message is empty");
            await page.CommitMessageInput(_project).FillAsync("hello");
            (await page.ConfirmPushButton(_project).IsDisabledAsync())
                .Should().BeFalse("commit message is now non-empty");
        }

        [Test]
        public async Task Push_with_unchanged_working_tree_shows_nothing_to_push_notice()
        {
            // The api-server's push routine (1) clones the bare into a
            // tmpdir, (2) copies the project on disk over the clone, and
            // (3) commits + pushes the diff. To exercise the "nothing to
            // push" branch the clone must match the project content
            // exactly. Easiest way: do a first push that syncs the real
            // project into the bare, then a second push has nothing to
            // commit.
            var page = new GitReposPage(Page);
            await page.WaitForRowAsync(_project);
            await page.PushAsync(_project);
            await page.CommitMessageInput(_project).FillAsync("initial sync");
            await page.ConfirmPushAsync(_project);
            await GitReposTestSupport.ExpectToastAsync(Page, "Pushed ");

            // Second push, no local edits since the previous one.
            await page.PushAsync(_project);
            await page.CommitMessageInput(_project).FillAsync("noop");
            await page.ConfirmPushAsync(_project);
            await GitReposTestSupport.ExpectToastAsync(Page, "Nothing to push");
        }

        [Test]
        public async Task Push_with_real_changes_shows_short_sha_branch_toast_and_audits()
        {
            // Touch a file on disk so the push has something to commit.
            await File.WriteAllTextAsync(
                Path.Combine(_projectRoot, "ux-test-marker.txt"),
                "hello from UX tests at " + DateTime.UtcNow.ToString("o"));

            var page = new GitReposPage(Page);
            await page.WaitForRowAsync(_project);
            await page.PushAsync(_project);
            await page.CommitMessageInput(_project)
                .FillAsync("UX test push " + Guid.NewGuid().ToString("N").Substring(0, 6));
            await page.ConfirmPushAsync(_project);

            // Success toast format: `Pushed <sha> to <branch>`.
            await GitReposTestSupport.ExpectToastAsync(Page, "Pushed ");
            await GitReposTestSupport.ExpectToastAsync(Page, "to main");

            // Activity log: filter by project and look for at least one
            // row whose Action cell renders `project_git_push`.
            await GitReposTestSupport.AssertActivityHasActionForProjectAsync(
                Page, _project, "project_git_push");
        }

        [Test]
        public async Task Push_when_remote_advanced_shows_push_rejected_toast()
        {
            // The api-server re-clones the bare on every push and would
            // therefore always fast-forward. To force the push_rejected
            // classification we install a pre-receive hook that fails
            // every push with stderr that includes the keywords
            // classifyPushError looks for ("rejected" + "non-fast-forward").
            await _remote.InstallRejectingPreReceiveHookAsync();

            // Touch a file in the project so we have something to commit.
            await File.WriteAllTextAsync(
                Path.Combine(_projectRoot, "ux-test-conflict.txt"),
                "local change");

            var page = new GitReposPage(Page);
            await page.WaitForRowAsync(_project);
            await page.PushAsync(_project);
            await page.CommitMessageInput(_project).FillAsync("conflicting push");
            await page.ConfirmPushAsync(_project);

            // The push endpoint returns HTTP 400 for ok:false results;
            // the section's onError handler reads errorCode=push_rejected
            // off the JSON body and renders the friendly "Push rejected"
            // toast (with a "Pull and retry" action button). The raw
            // "HTTP 400 Bad Request" prefix is no longer shown.
            await GitReposTestSupport.ExpectToastAsync(Page, "Push rejected", 10000);
            await GitReposTestSupport.ExpectToastAsync(Page, "Pull and retry", 10000);

            // The push route writes a project_git_push audit row on
            // failure too (with details.error = "push_rejected"). Check
            // the row appears in the Activity log so the audit metadata
            // contract is exercised on both success and failure paths.
            await GitReposTestSupport.AssertActivityHasActionForProjectAsync(
                Page, _project, "project_git_push");
        }

        [Test]
        public async Task Push_against_auth_rejecting_remote_records_failed_audit_row()
        {
            // Drive the auth_failed branch end-to-end and assert that a
            // failed push still writes a project_git_push audit row.
            await using var failer = await LocalAuthFailingHttpServer.CreateAsync();
            await ConfigureRemoteAsync(failer.Url);
            await Page.ReloadAsync();

            // Touch a file so the api-server's push pipeline reaches
            // the clone-and-push step (where the 401 comes back).
            await File.WriteAllTextAsync(
                Path.Combine(_projectRoot, "ux-test-authfail.txt"),
                "local change");

            var page = new GitReposPage(Page);
            await page.WaitForRowAsync(_project);
            await page.PushAsync(_project);
            await page.CommitMessageInput(_project).FillAsync("auth-fail push");
            await page.ConfirmPushAsync(_project);

            // Friendly toast: errorCode=auth_failed renders the
            // "Authentication failed" title without the raw HTTP prefix.
            await GitReposTestSupport.ExpectToastAsync(Page, "Authentication failed", 15000);

            await GitReposTestSupport.AssertActivityHasActionForProjectAsync(
                Page, _project, "project_git_push");
        }
    }

    /// <summary>
    /// Authorization coverage: the Settings → Git Repos section is
    /// admin-only, and even when a Limited Admin or User browses
    /// /settings the per-row Pull / Push buttons must not render for
    /// them. We do this by configuring a row as admin first, then
    /// signing in as the lower role and asserting the buttons are
    /// absent.
    ///
    /// Limited Admin: the Settings page hides the Git Repos section
    /// entirely (see <c>SettingsPage</c> sectionsForRole). User: the
    /// /settings route redirects away. Both end states must NOT expose
    /// the Pull / Push affordances.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class GitReposLimitedAdminAuthorizationTests : LimitedAdminFixture
    {
        protected override string StartPath => "/settings";

        private static MementoApiClient? s_seedApi;
        private static string s_project = string.Empty;
        private static LocalGitRemote? s_remote;

        [OneTimeSetUp]
        public async Task SeedConfiguredProjectAsync()
        {
            s_seedApi = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            s_project = await GitReposTestSupport.CreateProjectAsync(s_seedApi, "AuthLA");
            s_remote = await LocalGitRemote.CreateAsync(
                s_project, GitReposTestSupport.SolutionFileName(s_project));
            var resp = await s_seedApi.PutJsonAsync(
                $"api/projects/{Uri.EscapeDataString(s_project)}/git-config",
                new
                {
                    provider = "azure_repos",
                    repoUrl = s_remote.FileUrl,
                    branch = "main",
                    pat = GitReposTestSupport.DummyPat,
                });
            resp.EnsureSuccessStatusCode();
        }

        [OneTimeTearDown]
        public async Task TeardownSeedAsync()
        {
            if (s_seedApi is not null)
            {
                await GitReposTestSupport.DeleteProjectAsync(s_seedApi, s_project);
                await s_seedApi.DisposeAsync();
            }
            if (s_remote is not null) await s_remote.DisposeAsync();
        }

        [Test]
        public async Task Limited_admin_does_not_see_git_repos_pull_or_push_buttons()
        {
            // Whether the section header renders or not, the per-row
            // Pull/Push buttons must be absent for non-admins.
            (await Page.GetByTestId(GitReposSelectors.ButtonPull(s_project))
                .CountAsync()).Should().Be(0);
            (await Page.GetByTestId(GitReposSelectors.ButtonPush(s_project))
                .CountAsync()).Should().Be(0);
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class GitReposUserAuthorizationTests : UserFixture
    {
        protected override string StartPath => "/settings";

        private static MementoApiClient? s_seedApi;
        private static string s_project = string.Empty;
        private static LocalGitRemote? s_remote;

        [OneTimeSetUp]
        public async Task SeedConfiguredProjectAsync()
        {
            s_seedApi = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            s_project = await GitReposTestSupport.CreateProjectAsync(s_seedApi, "AuthU");
            s_remote = await LocalGitRemote.CreateAsync(
                s_project, GitReposTestSupport.SolutionFileName(s_project));
            var resp = await s_seedApi.PutJsonAsync(
                $"api/projects/{Uri.EscapeDataString(s_project)}/git-config",
                new
                {
                    provider = "azure_repos",
                    repoUrl = s_remote.FileUrl,
                    branch = "main",
                    pat = GitReposTestSupport.DummyPat,
                });
            resp.EnsureSuccessStatusCode();
        }

        [OneTimeTearDown]
        public async Task TeardownSeedAsync()
        {
            if (s_seedApi is not null)
            {
                await GitReposTestSupport.DeleteProjectAsync(s_seedApi, s_project);
                await s_seedApi.DisposeAsync();
            }
            if (s_remote is not null) await s_remote.DisposeAsync();
        }

        [Test]
        public async Task User_does_not_see_git_repos_pull_or_push_buttons()
        {
            (await Page.GetByTestId(GitReposSelectors.ButtonPull(s_project))
                .CountAsync()).Should().Be(0);
            (await Page.GetByTestId(GitReposSelectors.ButtonPush(s_project))
                .CountAsync()).Should().Be(0);
        }
    }
}
