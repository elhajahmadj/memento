using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Data;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;
using NUnit.Framework;
// ReSharper disable InconsistentNaming

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// End-to-end coverage for the Architectures editor surface
    /// (REQUIREMENTS.md §90-119): create / rename / duplicate / delete an
    /// architecture, plus the in-editor project &amp; file tree mutations
    /// that drive scaffold output.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ArchitecturesEditorTests : AdminFixture
    {
        protected override string StartPath => "/settings";

        [Test]
        public async Task New_architecture_creates_row_and_opens_editor()
        {
            var settings = new SettingsPage(Page);
            await settings.NewArchitectureAsync();

            // Editor opens automatically on a successful create.
            await Expect(T(SettingsSelectors.ButtonSaveArch))
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            // Default scaffold has the seeded ".Tests" project.
            await Expect(T(SettingsSelectors.SwitchTestsProject))
                .ToBeVisibleAsync();

            var editor = new ArchitectureEditorPage(Page);
            await editor.CloseAsync();

            // Back on settings, the new row exists with name "New Architecture".
            await Expect(Page.GetByText("New Architecture").First)
                .ToBeVisibleAsync();
        }

        [Test]
        public async Task Built_in_architecture_row_is_read_only()
        {
            // Built-in rows render only the duplicate button — no rename,
            // edit, or delete affordances. We don't pin to a specific
            // built-in id (those churn) so we look up the first row that
            // carries the "built-in" badge.
            await Page.WaitForSelectorAsync("[data-testid^='row-arch-']");
            var builtIn = Page.Locator("[data-testid^='row-arch-']")
                .Filter(new() { HasText = "built-in" })
                .First;
            await Assertions.Expect(builtIn).ToBeVisibleAsync();

            var id = (await builtIn.GetAttributeAsync("data-testid"))!
                .Substring("row-arch-".Length);

            // Edit / rename / delete buttons must be absent on built-in rows.
            (await Page.GetByTestId(SettingsSelectors.ButtonEditArch(id)).CountAsync())
                .Should().Be(0, "built-in architectures must not be editable");
            (await Page.GetByTestId(SettingsSelectors.ButtonRenameArch(id)).CountAsync())
                .Should().Be(0, "built-in architectures must not be renameable");
            (await Page.GetByTestId(SettingsSelectors.ButtonDeleteArch(id)).CountAsync())
                .Should().Be(0, "built-in architectures must not be deletable");
            // Duplicate must remain available.
            (await Page.GetByTestId(SettingsSelectors.ButtonDuplicateArch(id)).CountAsync())
                .Should().BeGreaterThan(0);
        }

        [Test]
        public async Task Edit_architecture_persists_project_and_file_changes()
        {
            // Seed: create a fresh blank arch we can mutate without touching
            // built-ins.
            var settings = new SettingsPage(Page);
            await settings.NewArchitectureAsync();
            await Expect(T(SettingsSelectors.ButtonSaveArch))
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            var editor = new ArchitectureEditorPage(Page);

            // Add a project, give it a per-run unique suffix so the
            // persistence assertion can pick the row created by *this*
            // test (architecture IDs are random UUIDs, multiple tests in
            // the suite create rows named "New Architecture").
            var uniqueSuffix = $".Pages{TestDataFactory.RunId.Replace("-", "")}";
            await editor.ClickAddProjectAsync();
            await editor.FillProjectSuffixAsync(uniqueSuffix);
            await editor.AddRootFolderAsync("Selectors");
            await editor.AddRootFileAsync("Marker.cs");

            // Nested folder + file inside Selectors. The hover-only action
            // buttons aren't visible by CSS, so we click with Force.
            await editor.AddNestedFolderUnderAsync("Selectors", "Buttons");
            await editor.AddNestedFileUnderAsync("Selectors", "ChildFile.cs");

            // Edit the root Marker.cs content and save it.
            await editor.SelectFileAsync(string.Empty, "Marker.cs");
            await editor.ToggleEditFileAsync();
            const string MarkerBody =
                "namespace MarkerNs;\nclass Marker {}";
            await editor.ReplaceFileContentAsync(MarkerBody);

            // Add a temp file then delete it — verifies the file delete
            // affordance round-trips correctly.
            await editor.AddRootFileAsync("Throwaway.cs");
            await editor.DeleteFileAsync(string.Empty, "Throwaway.cs");

            // Add a temp nested folder then delete it — verifies the
            // folder delete affordance round-trips and that empty
            // intermediate folders can be cleaned up.
            await editor.AddNestedFolderUnderAsync("Selectors", "TempScratch");
            await editor.DeleteFolderAsync("Selectors/TempScratch");

            // Rename a root file end-to-end so the rename affordance is
            // exercised against the same persistence round-trip.
            await editor.AddRootFileAsync("RenameMe.cs");
            await editor.RenameFileAsync(string.Empty, "RenameMe.cs", "Renamed.cs");

            await editor.SaveAsync();

            // Save toast / network round-trip — give it a beat then close.
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            await editor.CloseAsync();

            // Persistence check via the JSON API the UI itself talks to.
            // Run the fetch from the page so the existing session cookie
            // rides along automatically — no separate APIRequestContext.
            var json = await Page.EvaluateAsync<JsonElement>(
                @"async () => {
                    const r = await fetch('/api/architectures', { credentials: 'include' });
                    if (!r.ok) throw new Error('fetch failed: ' + r.status);
                    return await r.json();
                }");

            // Find the architecture that contains *our* uniquely-named
            // project (multiple tests create rows named "New Architecture").
            var custom = json.EnumerateArray()
                .First(a =>
                    a.GetProperty("isBuiltIn").GetBoolean() == false
                    && a.GetProperty("projects").EnumerateArray()
                        .Any(p => p.GetProperty("nameSuffix").GetString() == uniqueSuffix));

            var pages = custom.GetProperty("projects")
                .EnumerateArray()
                .First(p => p.GetProperty("nameSuffix").GetString() == uniqueSuffix);

            pages.ValueKind.Should().NotBe(JsonValueKind.Undefined,
                "the unique project added in the editor should round-trip");

            var selectors = pages.GetProperty("folders").EnumerateArray()
                .First(f => f.GetProperty("name").GetString() == "Selectors");

            // Nested folder added under Selectors must persist.
            selectors.GetProperty("folders").EnumerateArray()
                .Select(f => f.GetProperty("name").GetString())
                .Should().Contain("Buttons");
            // Nested file added under Selectors must persist.
            selectors.GetProperty("files").EnumerateArray()
                .Select(f => f.GetProperty("name").GetString())
                .Should().Contain("ChildFile.cs");

            // Nested folder added under Selectors then deleted in the
            // same session must NOT persist (round-trip on remove).
            selectors.GetProperty("folders").EnumerateArray()
                .Select(f => f.GetProperty("name").GetString())
                .Should().NotContain("TempScratch",
                    "the nested-folder delete affordance must round-trip");

            // Root files: Marker.cs persists with its edited content;
            // Throwaway.cs (added then deleted) does not; RenameMe.cs
            // is gone but its renamed twin Renamed.cs is present.
            var rootFiles = pages.GetProperty("files").EnumerateArray().ToList();
            rootFiles.Select(f => f.GetProperty("name").GetString())
                .Should().Contain("Marker.cs")
                .And.NotContain("Throwaway.cs")
                .And.Contain("Renamed.cs",
                    "the file rename affordance must round-trip via the API")
                .And.NotContain("RenameMe.cs");
            rootFiles.First(f => f.GetProperty("name").GetString() == "Marker.cs")
                .GetProperty("content").GetString()
                .Should().Contain("namespace MarkerNs",
                    "the file editor's content edit must round-trip via the API");

            // Persistence-across-restart proxy: rather than just reload
            // the same page (which keeps service workers, in-memory
            // module state and React Query caches alive), spin up a
            // *fresh BrowserContext* with the same admin storage state
            // and re-fetch from there. This proves the data is held by
            // the api-server on disk, not by any client-side state. We
            // can't trigger a real `process.exit` on the api-server from
            // a Playwright test (no admin restart endpoint exists), so
            // a fresh context is the strongest no-restart proxy.
            var freshContext = await browser!.NewContextAsync(BuildContextOptions());
            try
            {
                var freshPage = await freshContext.NewPageAsync();
                await freshPage.GotoAsync(MementoSettings.BaseUrl + "/settings");
                await freshPage.WaitForLoadStateAsync(LoadState.NetworkIdle);
                var reread = await freshPage.EvaluateAsync<JsonElement>(
                    @"async () => (await fetch('/api/architectures', { credentials: 'include' })).json()");
                reread.EnumerateArray()
                    .Any(a => a.GetProperty("projects").EnumerateArray()
                        .Any(p => p.GetProperty("nameSuffix").GetString() == uniqueSuffix))
                    .Should().BeTrue(
                        "custom architecture must survive a fresh browser context "
                        + "(proves disk-backed persistence on the api-server)");
            }
            finally
            {
                await freshContext.CloseAsync();
            }
        }

        [Test]
        public async Task Duplicate_creates_independent_deep_copy()
        {
            // Snapshot built-in architectures BEFORE duplicating.
            var before = await Page.EvaluateAsync<JsonElement>(
                @"async () => (await fetch('/api/architectures', { credentials: 'include' })).json()");
            var sourceBefore = before.EnumerateArray()
                .First(a => a.GetProperty("isBuiltIn").GetBoolean());
            var sourceId = sourceBefore.GetProperty("id").GetString();
            var sourceName = sourceBefore.GetProperty("name").GetString();
            var sourceFirstSuffix = sourceBefore.GetProperty("projects")
                .EnumerateArray().First()
                .GetProperty("nameSuffix").GetString();

            // Duplicate the built-in row.
            await Page.GetByTestId(SettingsSelectors.ButtonDuplicateArch(sourceId!))
                .ClickAsync();

            await Expect(T(SettingsSelectors.ButtonSaveArch))
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            // Mutate the copy: rename its first project's suffix to a
            // value that's clearly not the source's, then save.
            var editor = new ArchitectureEditorPage(Page);
            var mutatedSuffix = $".Mutated{TestDataFactory.RunId.Replace("-", "")}";
            await editor.FillProjectSuffixAsync(mutatedSuffix);
            await editor.SaveAsync();
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            await editor.CloseAsync();

            // Re-fetch and assert: the source is unchanged and the copy
            // carries the mutation. Independence proves the duplicate
            // produced a deep copy, not a shared reference.
            var after = await Page.EvaluateAsync<JsonElement>(
                @"async () => (await fetch('/api/architectures', { credentials: 'include' })).json()");
            var sourceAfter = after.EnumerateArray()
                .First(a => a.GetProperty("id").GetString() == sourceId);
            sourceAfter.GetProperty("projects")
                .EnumerateArray().First()
                .GetProperty("nameSuffix").GetString()
                .Should().Be(sourceFirstSuffix,
                    "mutating the duplicated architecture must not bleed into the source");

            after.EnumerateArray()
                .Any(a =>
                    a.GetProperty("isBuiltIn").GetBoolean() == false
                    && a.GetProperty("name").GetString() == $"{sourceName} (copy)"
                    && a.GetProperty("projects").EnumerateArray()
                        .Any(p => p.GetProperty("nameSuffix").GetString() == mutatedSuffix))
                .Should().BeTrue("the copy must carry the mutated suffix");
        }

        [Test]
        public async Task Rename_architecture_updates_row_name()
        {
            var settings = new SettingsPage(Page);
            await settings.NewArchitectureAsync();
            await Expect(T(SettingsSelectors.ButtonSaveArch))
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            var editor = new ArchitectureEditorPage(Page);
            await editor.CloseAsync();

            // Pick the freshest non-built-in row.
            var deleteButtons = Page.Locator("[data-testid^='button-delete-arch-']");
            var lastDelete = deleteButtons.Last;
            var testId = await lastDelete.GetAttributeAsync("data-testid");
            var archId = testId!.Substring("button-delete-arch-".Length);

            await settings.RenameArchitectureAsync(archId, "Renamed By Test");

            await Expect(Page.GetByText("Renamed By Test").First)
                .ToBeVisibleAsync(new() { Timeout = 10_000 });
        }

        [Test]
        public async Task Delete_architecture_removes_row()
        {
            var settings = new SettingsPage(Page);
            await settings.NewArchitectureAsync();
            await Expect(T(SettingsSelectors.ButtonSaveArch))
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            var editor = new ArchitectureEditorPage(Page);
            await editor.CloseAsync();

            var lastDelete = Page.Locator("[data-testid^='button-delete-arch-']").Last;
            var testId = await lastDelete.GetAttributeAsync("data-testid");
            var archId = testId!.Substring("button-delete-arch-".Length);

            var before = await Page.Locator("[data-testid^='row-arch-']").CountAsync();
            await settings.DeleteArchitectureAsync(archId);

            await Expect(T(SettingsSelectors.RowArch(archId)))
                .ToHaveCountAsync(0, new() { Timeout = 10_000 });
            (await Page.Locator("[data-testid^='row-arch-']").CountAsync())
                .Should().Be(before - 1);
        }

        [Test]
        public async Task Rename_file_in_editor_persists_via_api()
        {
            // Focused coverage for the rename-file affordance: seed a fresh
            // arch with a uniquely-named project so we can pick *our* row
            // out of the API response after save.
            var settings = new SettingsPage(Page);
            await settings.NewArchitectureAsync();
            await Expect(T(SettingsSelectors.ButtonSaveArch))
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            var editor = new ArchitectureEditorPage(Page);
            var uniqueSuffix = $".Rename{TestDataFactory.RunId.Replace("-", "")}";
            await editor.ClickAddProjectAsync();
            await editor.FillProjectSuffixAsync(uniqueSuffix);

            await editor.AddRootFileAsync("Before.cs");
            await editor.RenameFileAsync(string.Empty, "Before.cs", "After.cs");

            await editor.SaveAsync();
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            await editor.CloseAsync();

            var json = await Page.EvaluateAsync<JsonElement>(
                @"async () => (await fetch('/api/architectures', { credentials: 'include' })).json()");
            var ourProject = json.EnumerateArray()
                .First(a => a.GetProperty("isBuiltIn").GetBoolean() == false
                            && a.GetProperty("projects").EnumerateArray()
                                .Any(p => p.GetProperty("nameSuffix").GetString() == uniqueSuffix))
                .GetProperty("projects").EnumerateArray()
                .First(p => p.GetProperty("nameSuffix").GetString() == uniqueSuffix);

            ourProject.GetProperty("files").EnumerateArray()
                .Select(f => f.GetProperty("name").GetString())
                .Should().Contain("After.cs",
                    "the rename-file affordance must round-trip via the API")
                .And.NotContain("Before.cs",
                    "the original file name must be removed after rename");
        }

        [Test]
        public async Task Delete_folder_removes_its_contents_from_persisted_arch()
        {
            // Folder-delete is recursive ("Delete folder X and all its
            // contents?" in the UI). Seed a folder with a file inside,
            // delete the folder, and verify *both* are gone from the
            // saved JSON — guards against a regression where only the
            // folder reference is dropped while orphan children survive.
            var settings = new SettingsPage(Page);
            await settings.NewArchitectureAsync();
            await Expect(T(SettingsSelectors.ButtonSaveArch))
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            var editor = new ArchitectureEditorPage(Page);
            var uniqueSuffix = $".DelDir{TestDataFactory.RunId.Replace("-", "")}";
            await editor.ClickAddProjectAsync();
            await editor.FillProjectSuffixAsync(uniqueSuffix);

            await editor.AddRootFolderAsync("Doomed");
            await editor.AddNestedFolderUnderAsync("Doomed", "InnerDir");
            await editor.AddNestedFileUnderAsync("Doomed", "InnerFile.cs");

            // Now delete the parent folder; its inner folder + file must
            // disappear with it.
            await editor.DeleteFolderAsync("Doomed");

            await editor.SaveAsync();
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            await editor.CloseAsync();

            var json = await Page.EvaluateAsync<JsonElement>(
                @"async () => (await fetch('/api/architectures', { credentials: 'include' })).json()");
            var ourProject = json.EnumerateArray()
                .First(a => a.GetProperty("isBuiltIn").GetBoolean() == false
                            && a.GetProperty("projects").EnumerateArray()
                                .Any(p => p.GetProperty("nameSuffix").GetString() == uniqueSuffix))
                .GetProperty("projects").EnumerateArray()
                .First(p => p.GetProperty("nameSuffix").GetString() == uniqueSuffix);

            // The parent folder is gone — and because folder data is
            // nested under it, that single absence implies its children
            // are also gone. Assert explicitly to be unambiguous.
            var rootFolders = ourProject.GetProperty("folders").EnumerateArray()
                .Select(f => f.GetProperty("name").GetString())
                .ToList();
            rootFolders.Should().NotContain("Doomed",
                "deleting the parent folder must remove it from the saved JSON");

            // No surviving folder anywhere in *our* project should
            // carry the deleted children — a regression where folder
            // deletion left orphan rows behind would surface here.
            // Scoped to our uniquely-suffixed project so other archs
            // in the response can't accidentally satisfy the assertion.
            var ourProjectJson = ourProject.ToString();
            ourProjectJson.Should().NotContain("InnerDir",
                "the deleted folder's nested folder must not survive");
            ourProjectJson.Should().NotContain("InnerFile.cs",
                "the deleted folder's nested file must not survive");
        }

        [Test]
        public async Task Import_architecture_via_file_picker_adds_row()
        {
            // Drives the JSON-import dropzone from the file-picker side
            // (the hidden <input type=file> backing the Import button).
            // Drag-drop uses the same handler under the hood; uploading
            // through the picker is the deterministic Playwright path.
            var settings = new SettingsPage(Page);

            // Snapshot the current row count so we can assert net +1.
            var beforeCount = await Page.Locator("[data-testid^='row-arch-']").CountAsync();

            // Unique name + suffix so multiple runs don't collide with
            // each other or with seed data.
            var uniqueName = $"Imported {TestDataFactory.RunId}";
            var uniqueSuffix = $".Imp{TestDataFactory.RunId.Replace("-", "")}";
            var json = $@"{{
  ""name"": ""{uniqueName}"",
  ""isBuiltIn"": false,
  ""projects"": [
    {{
      ""id"": """",
      ""nameSuffix"": ""{uniqueSuffix}"",
      ""isTestsProject"": false,
      ""folders"": [],
      ""files"": []
    }}
  ]
}}";

            await settings.ImportArchitectureJsonAsync("imported-arch.json", json);

            // The new architecture row should appear in the list.
            await Expect(Page.GetByText(uniqueName).First)
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            // Net +1 row in the architectures list.
            await Expect(Page.Locator("[data-testid^='row-arch-']"))
                .ToHaveCountAsync(beforeCount + 1, new() { Timeout = 10_000 });

            // Also verify the imported architecture is queryable via
            // the same API the UI talks to — proves the JSON survived
            // the upload + parse + upsert round-trip, not just the
            // optimistic UI render.
            var apiJson = await Page.EvaluateAsync<JsonElement>(
                @"async () => (await fetch('/api/architectures', { credentials: 'include' })).json()");
            apiJson.EnumerateArray()
                .Any(a => a.GetProperty("name").GetString() == uniqueName
                          && a.GetProperty("isBuiltIn").GetBoolean() == false
                          && a.GetProperty("projects").EnumerateArray()
                              .Any(p => p.GetProperty("nameSuffix").GetString() == uniqueSuffix))
                .Should().BeTrue(
                    "imported architecture must persist through the api-server, "
                    + "not just appear optimistically in the UI");
        }

        [Test]
        public async Task Drag_and_drop_architecture_onto_dropzone_adds_row()
        {
            // Drives the *visible* dropzone (`dropzone-architectures`) end
            // to end. The Import button sibling test only exercises the
            // hidden <input type=file>; the drag-drop path goes through
            // a separate `handleDrop` + `collectJsonFilesFromDrop`
            // (`webkitGetAsEntry`) branch in `use-architecture-import.ts`
            // that can silently regress without anyone noticing until a
            // real user drags a JSON file in.
            var settings = new SettingsPage(Page);

            var beforeCount = await Page.Locator("[data-testid^='row-arch-']").CountAsync();

            var uniqueName = $"Dropped {TestDataFactory.RunId}";
            var uniqueSuffix = $".Drop{TestDataFactory.RunId.Replace("-", "")}";
            var json = $@"{{
  ""name"": ""{uniqueName}"",
  ""isBuiltIn"": false,
  ""projects"": [
    {{
      ""id"": """",
      ""nameSuffix"": ""{uniqueSuffix}"",
      ""isTestsProject"": false,
      ""folders"": [],
      ""files"": []
    }}
  ]
}}";

            await settings.DropJsonFilesAsync(
                SettingsSelectors.DropzoneArchitectures,
                ("dropped-arch.json", json));

            await Expect(Page.GetByText(uniqueName).First)
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            await Expect(Page.Locator("[data-testid^='row-arch-']"))
                .ToHaveCountAsync(beforeCount + 1, new() { Timeout = 10_000 });

            // Persistence round-trip via the same /api/architectures the
            // UI talks to — proves the dropped file made it through the
            // upload + parse + upsert path, not just the optimistic UI.
            var apiJson = await Page.EvaluateAsync<JsonElement>(
                @"async () => (await fetch('/api/architectures', { credentials: 'include' })).json()");
            apiJson.EnumerateArray()
                .Any(a => a.GetProperty("name").GetString() == uniqueName
                          && a.GetProperty("isBuiltIn").GetBoolean() == false
                          && a.GetProperty("projects").EnumerateArray()
                              .Any(p => p.GetProperty("nameSuffix").GetString() == uniqueSuffix))
                .Should().BeTrue(
                    "drag-and-drop import must persist through the api-server, "
                    + "not just appear optimistically in the UI");
        }

        [Test]
        public async Task Drag_and_drop_onto_results_dialog_retries_failed_import()
        {
            // Covers the dialog-level dropzone (`handleDialogDrop` in
            // `use-architecture-import.ts`), which has its *own* depth
            // tracking and stopPropagation logic separate from the
            // section-level dropzone. Steps:
            //   1. Drop two files on the section dropzone — one valid,
            //      one invalid JSON — so `importFiles` opens the
            //      results dialog with one error row.
            //   2. Drop a corrected version of the failed file (same
            //      name, valid body) onto the dialog. `handleDialogDrop`
            //      → `handleDroppedJsonFiles` should match the failed
            //      name and route through `retryFailedFiles`.
            //   3. Assert the dialog row flips to success and the
            //      previously-failed architecture is now persisted via
            //      /api/architectures.
            var settings = new SettingsPage(Page);

            var goodName = $"DropOk {TestDataFactory.RunId}";
            var goodSuffix = $".DropOk{TestDataFactory.RunId.Replace("-", "")}";
            var goodJson = $@"{{
  ""name"": ""{goodName}"",
  ""isBuiltIn"": false,
  ""projects"": [
    {{ ""id"": """", ""nameSuffix"": ""{goodSuffix}"", ""isTestsProject"": false, ""folders"": [], ""files"": [] }}
  ]
}}";

            var retryName = $"DropRetry {TestDataFactory.RunId}";
            var retrySuffix = $".DropRetry{TestDataFactory.RunId.Replace("-", "")}";
            var retryFileName = "broken-arch.json";
            var validRetryJson = $@"{{
  ""name"": ""{retryName}"",
  ""isBuiltIn"": false,
  ""projects"": [
    {{ ""id"": """", ""nameSuffix"": ""{retrySuffix}"", ""isTestsProject"": false, ""folders"": [], ""files"": [] }}
  ]
}}";

            // Step 1: drop both onto the section dropzone. The bad file
            // has a .json extension (so the collector accepts it) but
            // unparseable contents (so parseOneFile rejects it as "not
            // valid JSON"). A second valid file is needed because the
            // results dialog only opens for `files.length > 1`.
            await settings.DropJsonFilesAsync(
                SettingsSelectors.DropzoneArchitectures,
                ("good-arch.json", goodJson),
                (retryFileName, "this is not valid json {{{"));

            await Expect(T(SettingsSelectors.DialogImportResults))
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            // The bad-file row should be present and labelled with its
            // failure reason — proves the dialog shows the failure that
            // we are about to retry.
            await Expect(Page.GetByText(retryFileName).First).ToBeVisibleAsync();

            // Step 2: drop a corrected file (same name) onto the dialog.
            await settings.DropJsonFilesAsync(
                SettingsSelectors.DialogImportResults,
                (retryFileName, validRetryJson));

            // Step 3a: the dialog row for the previously-failed file
            // should now display the new architecture name (retry
            // success replaces the error reason with "Imported as ...").
            await Expect(Page.GetByText(retryName).First)
                .ToBeVisibleAsync(new() { Timeout = 10_000 });

            // Step 3b: persistence round-trip — both the original good
            // import and the retried one must be queryable via the API.
            var apiJson = await Page.EvaluateAsync<JsonElement>(
                @"async () => (await fetch('/api/architectures', { credentials: 'include' })).json()");
            var customs = apiJson.EnumerateArray()
                .Where(a => a.GetProperty("isBuiltIn").GetBoolean() == false)
                .ToList();
            customs.Any(a => a.GetProperty("name").GetString() == goodName
                             && a.GetProperty("projects").EnumerateArray()
                                 .Any(p => p.GetProperty("nameSuffix").GetString() == goodSuffix))
                .Should().BeTrue(
                    "the valid sibling from the multi-file drop must persist");
            customs.Any(a => a.GetProperty("name").GetString() == retryName
                             && a.GetProperty("projects").EnumerateArray()
                                 .Any(p => p.GetProperty("nameSuffix").GetString() == retrySuffix))
                .Should().BeTrue(
                    "the dialog-dropzone retry must round-trip through /api/architectures, "
                    + "not just flip the row label optimistically");
        }

        // Local sugar mirroring PageObjectBase.T() for tests that don't
        // hold a page object.
        private ILocator T(string testId) => Page.GetByTestId(testId);

        private static IPageAssertions Expect(IPage page) => Assertions.Expect(page);
        private static ILocatorAssertions Expect(ILocator locator) => Assertions.Expect(locator);
    }
}
