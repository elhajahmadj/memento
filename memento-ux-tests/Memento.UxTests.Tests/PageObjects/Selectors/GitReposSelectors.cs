namespace Memento.UxTests.Tests.PageObjects.Selectors
{
    /// <summary>
    /// data-testid constants for the Settings → Git Repos section
    /// (rendered by <c>GitReposSection</c> /
    /// <c>artifacts/test-builder/src/features/settings/presentation/sections/azure-repos-section.tsx</c>).
    /// Per-row testids are parameterized by project name so the suite
    /// can drive a freshly-minted UX-tests project without colliding
    /// with seeded rows.
    /// </summary>
    public static class GitReposSelectors
    {
        public const string SectionGitRepos = "settings-section-git-repos";

        public static string Row(string project) => $"row-git-repos-{project}";
        public static string ButtonEdit(string project) => $"button-git-repos-edit-{project}";
        public static string ButtonPull(string project) => $"button-git-repos-pull-{project}";
        public static string ButtonPush(string project) => $"button-git-repos-push-{project}";
        public static string ButtonReplacePat(string project) => $"button-git-repos-replace-pat-{project}";
        public static string ButtonSave(string project) => $"button-git-repos-save-{project}";
        public static string ButtonConfirmPull(string project) => $"button-git-repos-confirm-pull-{project}";
        public static string ButtonConfirmPush(string project) => $"button-git-repos-confirm-push-{project}";
        public static string SelectProvider(string project) => $"select-git-repos-provider-{project}";
        public static string InputUrl(string project) => $"input-git-repos-url-{project}";
        public static string InputBranch(string project) => $"input-git-repos-branch-{project}";
        public static string InputPat(string project) => $"input-git-repos-pat-{project}";
        public static string InputCommitMessage(string project) => $"input-git-repos-commit-message-{project}";
    }
}
