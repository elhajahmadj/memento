using System.Threading.Tasks;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects
{
    /// <summary>
    /// Page object for the Settings → Git Repos section. The section
    /// renders one row per available memento project; every accessor
    /// here is therefore parameterized by the project name so the
    /// fixture can target a freshly-minted UX-test project without
    /// colliding with seeded rows.
    /// </summary>
    public sealed class GitReposPage : PageObjectBase
    {
        public GitReposPage(IPage page) : base(page) { }

        public ILocator Section => T(GitReposSelectors.SectionGitRepos);
        public ILocator Row(string project) => T(GitReposSelectors.Row(project));
        public ILocator EditButton(string project) => T(GitReposSelectors.ButtonEdit(project));
        public ILocator PullButton(string project) => T(GitReposSelectors.ButtonPull(project));
        public ILocator PushButton(string project) => T(GitReposSelectors.ButtonPush(project));
        public ILocator ReplacePatButton(string project) => T(GitReposSelectors.ButtonReplacePat(project));
        public ILocator SaveButton(string project) => T(GitReposSelectors.ButtonSave(project));
        public ILocator ConfirmPullButton(string project) => T(GitReposSelectors.ButtonConfirmPull(project));
        public ILocator ConfirmPushButton(string project) => T(GitReposSelectors.ButtonConfirmPush(project));
        public ILocator ProviderSelect(string project) => T(GitReposSelectors.SelectProvider(project));
        public ILocator UrlInput(string project) => T(GitReposSelectors.InputUrl(project));
        public ILocator BranchInput(string project) => T(GitReposSelectors.InputBranch(project));
        public ILocator PatInput(string project) => T(GitReposSelectors.InputPat(project));
        public ILocator CommitMessageInput(string project) => T(GitReposSelectors.InputCommitMessage(project));

        /// <summary>
        /// Settings → Git Repos lives inside a CollapsibleSection that
        /// defaults to closed. Expand it (idempotent — clicking when
        /// open would collapse it, so we check state first) before
        /// asserting anything inside.
        /// </summary>
        public async Task ExpandSectionAsync()
        {
            var trigger = Page.GetByTestId("collapsible-trigger-git-repos");
            await trigger.WaitForAsync(new() { Timeout = 10000 });
            var state = await trigger.GetAttributeAsync("data-state");
            if (state != "open")
                await trigger.ClickAsync();
        }

        public async Task WaitForRowAsync(string project, int timeoutMs = 15000)
        {
            await ExpandSectionAsync();
            // The Git Repos section lists projects asynchronously through
            // /api/projects/available, so a freshly-created project may
            // take a beat to render after navigation.
            await Row(project).WaitForAsync(new() { Timeout = timeoutMs });
        }

        public async Task OpenConfigureAsync(string project)
        {
            await EditButton(project).ClickAsync();
            await UrlInput(project).WaitForAsync(new() { Timeout = 5000 });
        }

        public async Task FillConfigureAsync(
            string project,
            string provider,
            string url,
            string branch,
            string? pat)
        {
            await RadixSelectHelper.SelectByLabelAsync(
                Page,
                GitReposSelectors.SelectProvider(project),
                provider == "github" ? "GitHub" : "Azure Repos");
            await UrlInput(project).FillAsync(url);
            await BranchInput(project).FillAsync(branch);
            if (pat is not null)
                await PatInput(project).FillAsync(pat);
        }

        public Task SaveAsync(string project) => SaveButton(project).ClickAsync();
        public Task PullAsync(string project) => PullButton(project).ClickAsync();
        public Task ConfirmPullAsync(string project) => ConfirmPullButton(project).ClickAsync();
        public Task PushAsync(string project) => PushButton(project).ClickAsync();
        public Task ConfirmPushAsync(string project) => ConfirmPushButton(project).ClickAsync();
    }
}
