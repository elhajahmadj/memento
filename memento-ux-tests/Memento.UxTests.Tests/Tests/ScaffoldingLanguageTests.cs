using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Data;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// Coverage for multi-language scaffolding (REQUIREMENTS.md §360-395).
    /// Each language scaffolds the on-disk project tree differently; we
    /// drive the new-project dialog end-to-end and assert the language's
    /// signature marker file shows up in the workbench's file tree.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ScaffoldingLanguageTests : AdminFixture
    {
        // Per-language signature marker file at the project root. The
        // workbench file tree uses `tree-node-<relPath>` testids with `/`
        // replaced by `-`; root-level files end up as `tree-node-<file>`.
        [TestCase(SupportedLanguage.Csharp,  "<sln>.sln",          TestName = "Scaffold C# emits .sln")]
        [TestCase(SupportedLanguage.Python,  "pyproject.toml",     TestName = "Scaffold Python emits pyproject.toml")]
        [TestCase(SupportedLanguage.Nodejs,  "package.json",       TestName = "Scaffold Node.js emits package.json")]
        [TestCase(SupportedLanguage.Java,    "pom.xml",            TestName = "Scaffold Java emits pom.xml")]
        public async Task Scaffold_creates_language_specific_marker(
            SupportedLanguage language,
            string markerTemplate)
        {
            var solution = TestDataFactory.ProjectName(language.ToString());
            var marker = markerTemplate.Replace("<sln>", solution);

            var home = new HomePage(Page);
            await home.ClickNewProjectAsync();

            var dialog = new NewProjectDialog(Page);
            await dialog.ChooseLanguageAsync(language);
            await dialog.FillBasicAsync(
                solutionName: solution,
                testProject:  solution + ".Tests",
                ns:           "Memento.Generated");
            await dialog.SubmitAsync();

            // The app navigates to /workbench on a successful create.
            await Page.WaitForURLAsync(url => url.Contains("/workbench"),
                new() { Timeout = 30_000 });
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);

            // Root-level marker should be visible in the file tree.
            await Assertions.Expect(
                Page.GetByTestId(WorkbenchSelectors.TreeNode(marker)))
                .ToBeVisibleAsync(new() { Timeout = 15_000 });
        }

        // Spot-check that each language emits a *correct* signature file
        // body, not just that some file exists at the expected path. The
        // checks are intentionally narrow (one substring per language)
        // so they survive scaffold-template tweaks but still catch a
        // wholesale regression where a language stops generating real
        // content.
        [TestCase(SupportedLanguage.Csharp, "<sln>.sln",                   "Visual Studio")]
        [TestCase(SupportedLanguage.Python, "pyproject.toml",              "[project]")]
        [TestCase(SupportedLanguage.Nodejs, "package.json",                "@playwright/test")]
        [TestCase(SupportedLanguage.Java,   "pom.xml",                     "<modelVersion>")]
        public async Task Scaffold_signature_file_has_expected_content(
            SupportedLanguage language,
            string markerTemplate,
            string expectedSubstring)
        {
            var solution = TestDataFactory.ProjectName(language + "Body");
            var marker = markerTemplate.Replace("<sln>", solution);

            await ScaffoldDefaultAsync(language, solution);

            // Click the file in the workbench tree, then enter edit
            // mode so the raw content is exposed via the textarea
            // (the read-only view uses SyntaxHighlighter and has no
            // stable testid).
            await Page.GetByTestId(WorkbenchSelectors.TreeNode(marker))
                .ClickAsync();
            await Page.GetByTestId(WorkbenchSelectors.ButtonEditFile)
                .ClickAsync();
            await Assertions.Expect(
                Page.GetByTestId(WorkbenchSelectors.TextareaFileEditor))
                .ToContainTextAsync(expectedSubstring,
                    new() { Timeout = 15_000 });
        }

        [Test]
        public async Task Tests_project_marker_drives_scaffold_test_project_name()
        {
            // Build a custom architecture with two projects, then flip
            // the *non-default* one to be the tests project. Scaffold a
            // C# project against the custom arch and assert the API
            // response says testProjectName matches the toggled project,
            // not the original .Tests one.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/settings");
            var settings = new SettingsPage(Page);
            await settings.NewArchitectureAsync();

            var editor = new ArchitectureEditorPage(Page);
            await Assertions.Expect(
                Page.GetByTestId(SettingsSelectors.ButtonSaveArch))
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            // The blank arch ships with a single ".Tests" project that
            // is already the tests project. Add a second project, then
            // toggle IT to be the tests project. The Switch on the
            // *current* tests project is disabled, so we add the new
            // project (auto-selected after add), give it a unique
            // suffix, and toggle its switch on.
            var marker = $".Marker{TestDataFactory.RunId.Replace("-", "")}";
            await editor.ClickAddProjectAsync();
            await editor.FillProjectSuffixAsync(marker);
            await editor.ToggleTestsProjectAsync();
            await editor.SaveAsync();
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            await editor.CloseAsync();

            // Rename the just-saved arch to a per-run unique name so the
            // dialog can pick exactly *our* row in
            // ChooseArchitectureAsync. Multiple parallel tests create
            // rows literally named "New Architecture", which would
            // otherwise pollute the role-name lookup.
            var archName = $"MarkerArch-{TestDataFactory.RunId}";
            var lastDeleteId = await Page.Locator(
                "[data-testid^='button-delete-arch-']").Last
                    .GetAttributeAsync("data-testid");
            var archId = lastDeleteId!.Substring("button-delete-arch-".Length);
            await settings.RenameArchitectureAsync(archId, archName);
            await Assertions.Expect(Page.GetByText(archName).First)
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            // Scaffold against the just-saved arch.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/");
            var solution = TestDataFactory.ProjectName("MarkerDrives");

            var home = new HomePage(Page);
            await home.ClickNewProjectAsync();

            var dialog = new NewProjectDialog(Page);
            await dialog.ChooseLanguageAsync(SupportedLanguage.Csharp);
            await dialog.ChooseArchitectureAsync(archName);
            await dialog.FillBasicAsync(
                solutionName: solution,
                testProject:  solution + ".Tests",   // ignored by arch
                ns:           "Memento.MarkerNs");

            // Capture the POST response so we can inspect testProjectName
            // without scraping the file tree.
            var responseTask = Page.WaitForResponseAsync(r =>
                r.Url.EndsWith("/api/projects") && r.Request.Method == "POST");
            await dialog.SubmitAsync();
            var response = await responseTask;
            response.Status.Should().Be(201);
            var body = await response.JsonAsync();
            body.HasValue.Should().BeTrue();

            body!.Value.GetProperty("testProjectName").GetString()
                .Should().Be(solution + marker,
                    "the project flagged isTestsProject in the architecture editor "
                    + "must drive the scaffolded testProjectName");

            // And the matching folder shows up in the workbench file
            // tree (not the default ".Tests" one).
            await Page.WaitForURLAsync(url => url.Contains("/workbench"),
                new() { Timeout = 30_000 });
            await Assertions.Expect(
                Page.GetByTestId(WorkbenchSelectors.TreeNode(solution + marker)))
                .ToBeVisibleAsync(new() { Timeout = 15_000 });
        }

        // Internal helper — submit the new-project dialog with default
        // values for the chosen language and wait for the workbench.
        private async Task ScaffoldDefaultAsync(SupportedLanguage language, string solution)
        {
            var home = new HomePage(Page);
            await home.ClickNewProjectAsync();
            var dialog = new NewProjectDialog(Page);
            await dialog.ChooseLanguageAsync(language);
            await dialog.FillBasicAsync(
                solutionName: solution,
                testProject:  solution + ".Tests",
                ns:           "Memento.Generated");
            await dialog.SubmitAsync();
            await Page.WaitForURLAsync(url => url.Contains("/workbench"),
                new() { Timeout = 30_000 });
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
        }

        [Test]
        public async Task Scaffold_csharp_emits_tests_project_folder()
        {
            var solution = TestDataFactory.ProjectName("CsharpTests");

            var home = new HomePage(Page);
            await home.ClickNewProjectAsync();

            var dialog = new NewProjectDialog(Page);
            await dialog.ChooseLanguageAsync(SupportedLanguage.Csharp);
            await dialog.FillBasicAsync(
                solutionName: solution,
                testProject:  solution + ".Tests",
                ns:           "Memento.Generated");
            await dialog.SubmitAsync();

            await Page.WaitForURLAsync(url => url.Contains("/workbench"),
                new() { Timeout = 30_000 });

            // The default C# arch produces .Tests, .Shared and
            // .Infrastructure project folders alongside the .sln file.
            var expectedFolders = new[] { ".Tests", ".Shared", ".Infrastructure" };
            foreach (var suffix in expectedFolders)
            {
                await Assertions.Expect(
                    Page.GetByTestId(WorkbenchSelectors.TreeNode(solution + suffix)))
                    .ToBeVisibleAsync(new() { Timeout = 15_000 });
            }
        }

        [Test]
        public async Task Scaffold_java_emits_module_layout()
        {
            var solution = TestDataFactory.ProjectName("Java");

            var home = new HomePage(Page);
            await home.ClickNewProjectAsync();

            var dialog = new NewProjectDialog(Page);
            await dialog.ChooseLanguageAsync(SupportedLanguage.Java);
            await dialog.FillBasicAsync(
                solutionName: solution,
                testProject:  solution + "-tests",
                ns:           "com.memento.generated");
            await dialog.SubmitAsync();

            await Page.WaitForURLAsync(url => url.Contains("/workbench"),
                new() { Timeout = 30_000 });

            // Maven multi-module layout: <sln>-shared, <sln>-infrastructure,
            // <sln>-tests modules + a root pom.xml.
            await Assertions.Expect(
                Page.GetByTestId(WorkbenchSelectors.TreeNode("pom.xml")))
                .ToBeVisibleAsync(new() { Timeout = 15_000 });

            foreach (var suffix in new[] { "-shared", "-infrastructure", "-tests" })
            {
                await Assertions.Expect(
                    Page.GetByTestId(WorkbenchSelectors.TreeNode(solution + suffix)))
                    .ToBeVisibleAsync(new() { Timeout = 15_000 });
            }

            // Recorded page-object interfaces land under a dedicated
            // `pages/interfaces/` package inside the shared module — the
            // Java equivalent of C#'s `PageObjects/Interfaces/` layout.
            // Verify the package folder exists by opening it in the
            // workbench tree (the recorder writes I<Suite>Actions.java
            // files in here at recording-finalize time).
            var pkg = "com/memento/generated".Replace('.', '/');
            var sharedJavaRoot =
                $"{solution}-shared/src/main/java/{pkg}/pages/interfaces";
            await Assertions.Expect(
                Page.GetByTestId(WorkbenchSelectors.TreeNode(sharedJavaRoot)))
                .ToBeVisibleAsync(new() { Timeout = 15_000 });
        }

        [Test]
        public async Task Scaffold_python_emits_conftest_and_pyproject()
        {
            var solution = TestDataFactory.ProjectName("Python");

            var home = new HomePage(Page);
            await home.ClickNewProjectAsync();

            var dialog = new NewProjectDialog(Page);
            await dialog.ChooseLanguageAsync(SupportedLanguage.Python);
            await dialog.FillBasicAsync(
                solutionName: solution,
                testProject:  solution + "_tests",
                ns:           "memento.generated");
            await dialog.SubmitAsync();

            await Page.WaitForURLAsync(url => url.Contains("/workbench"),
                new() { Timeout = 30_000 });

            await Assertions.Expect(
                Page.GetByTestId(WorkbenchSelectors.TreeNode("pyproject.toml")))
                .ToBeVisibleAsync(new() { Timeout = 15_000 });
            await Assertions.Expect(
                Page.GetByTestId(WorkbenchSelectors.TreeNode("conftest.py")))
                .ToBeVisibleAsync(new() { Timeout = 15_000 });
        }

        [Test]
        public async Task Scaffold_nodejs_emits_playwright_config()
        {
            var solution = TestDataFactory.ProjectName("Node");

            var home = new HomePage(Page);
            await home.ClickNewProjectAsync();

            var dialog = new NewProjectDialog(Page);
            await dialog.ChooseLanguageAsync(SupportedLanguage.Nodejs);
            await dialog.FillBasicAsync(
                solutionName: solution,
                testProject:  solution + "-tests",
                ns:           "memento.generated");
            await dialog.SubmitAsync();

            await Page.WaitForURLAsync(url => url.Contains("/workbench"),
                new() { Timeout = 30_000 });

            await Assertions.Expect(
                Page.GetByTestId(WorkbenchSelectors.TreeNode("package.json")))
                .ToBeVisibleAsync(new() { Timeout = 15_000 });
            await Assertions.Expect(
                Page.GetByTestId(WorkbenchSelectors.TreeNode("playwright.config.ts")))
                .ToBeVisibleAsync(new() { Timeout = 15_000 });
        }

        [Test]
        public async Task Custom_architecture_namespace_substitutes_at_scaffold_time()
        {
            // 1. Create a custom architecture with a single project that
            //    contains a file referencing {{Namespace}}.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/settings");
            var settings = new SettingsPage(Page);
            await settings.NewArchitectureAsync();

            var editor = new ArchitectureEditorPage(Page);
            await Assertions.Expect(Page.GetByTestId(SettingsSelectors.ButtonSaveArch))
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            // The seeded blank arch already has a ".Tests" project; rename
            // its existing sole file would be brittle, so add a new file
            // at root with our marker content.
            await editor.AddRootFileAsync("NamespaceMarker.cs");
            await editor.SelectFileAsync(string.Empty, "NamespaceMarker.cs");
            await editor.ToggleEditFileAsync();
            const string MarkerSource = "namespace {{Namespace}};\nclass M {}";
            await editor.ReplaceFileContentAsync(MarkerSource);
            await editor.SaveAsync();
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            await editor.CloseAsync();

            // Rename the just-saved arch to a per-run unique name so the
            // dialog's role-name lookup picks exactly *our* row even when
            // other tests in the suite create rows literally named
            // "New Architecture" in parallel.
            var archName = $"SubstArch-{TestDataFactory.RunId}";
            var lastDeleteId = await Page.Locator(
                "[data-testid^='button-delete-arch-']").Last
                    .GetAttributeAsync("data-testid");
            var archId = lastDeleteId!.Substring("button-delete-arch-".Length);
            await settings.RenameArchitectureAsync(archId, archName);
            await Assertions.Expect(Page.GetByText(archName).First)
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            // 2. Scaffold a new C# project against the custom arch.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/");
            var solution = TestDataFactory.ProjectName("Subst");
            const string Namespace = "Memento.Substituted";

            var home = new HomePage(Page);
            await home.ClickNewProjectAsync();

            var dialog = new NewProjectDialog(Page);
            await dialog.ChooseLanguageAsync(SupportedLanguage.Csharp);
            await dialog.ChooseArchitectureAsync(archName);
            await dialog.FillBasicAsync(
                solutionName: solution,
                testProject:  solution + ".Tests",
                ns:           Namespace);
            await dialog.SubmitAsync();

            await Page.WaitForURLAsync(url => url.Contains("/workbench"),
                new() { Timeout = 30_000 });

            // 3. Open the marker file in the workbench and assert the
            //    {{Namespace}} placeholder was replaced with the chosen
            //    namespace.
            await Page.GetByTestId(
                WorkbenchSelectors.TreeNode(solution + ".Tests/NamespaceMarker.cs"))
                .ClickAsync();
            await Page.GetByTestId(WorkbenchSelectors.ButtonEditFile)
                .ClickAsync();

            await Assertions.Expect(Page.GetByTestId(WorkbenchSelectors.TextareaFileEditor))
                .ToContainTextAsync(Namespace, new() { Timeout = 15_000 });
            await Assertions.Expect(Page.GetByTestId(WorkbenchSelectors.TextareaFileEditor))
                .Not.ToContainTextAsync("{{Namespace}}");
        }
    }
}
