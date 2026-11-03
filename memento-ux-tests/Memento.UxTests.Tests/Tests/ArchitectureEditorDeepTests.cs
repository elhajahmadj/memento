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

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// Deeper architecture-editor coverage focused on the
    /// add-project + add-root-file/folder + edit-with-find/replace
    /// + save+reload round-trip. The existing
    /// <see cref="ArchitecturesEditorTests"/> covers the persistence
    /// surface broadly; this fixture isolates the find/replace
    /// affordance (CodeMirror's Mod-Alt-F panel) and verifies it
    /// reliably mutates buffered content before save and after a
    /// fresh-context reload.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ArchitectureEditorDeepTests : AdminFixture
    {
        protected override string StartPath => "/settings";

        [Test]
        public async Task Add_project_root_folder_root_file_then_find_replace_saves_and_reloads()
        {
            var settings = new SettingsPage(Page);
            await settings.NewArchitectureAsync();
            await Page.GetByTestId(SettingsSelectors.ButtonSaveArch)
                .WaitForAsync(new()
                {
                    State = WaitForSelectorState.Visible,
                    Timeout = 10_000,
                });

            var editor = new ArchitectureEditorPage(Page);

            // 1) Add a uniquely-named project so we can find this row
            // back in the JSON dump regardless of how many "New
            // Architecture" rows other tests have seeded in parallel.
            var unique = $".Deep{TestDataFactory.RunId.Replace("-", "")}";
            await editor.ClickAddProjectAsync();
            await editor.FillProjectSuffixAsync(unique);

            // 2) Root folder + root file additions.
            await editor.AddRootFolderAsync("Pages");
            await editor.AddRootFileAsync("Marker.cs");

            // 3) Edit Marker.cs and use the CodeMirror find/replace
            // panel to swap a needle for a unique replacement so the
            // post-save dump can hard-assert the panel actually fired.
            await editor.SelectFileAsync(string.Empty, "Marker.cs");
            await editor.ToggleEditFileAsync();

            const string Body =
                "namespace MarkerNs;\n"
                + "// MARKER_NEEDLE one\n"
                + "// MARKER_NEEDLE two\n"
                + "class Marker {}";
            await editor.ReplaceFileContentAsync(Body);

            var replacement = $"REPLACED_{TestDataFactory.RunId.Replace("-", "")}";
            await editor.FindReplaceInFileAsync("MARKER_NEEDLE", replacement);

            // The buffer now reflects the replacement before save.
            (await editor.ReadFileContentAsync())
                .Should().Contain(replacement,
                    "find-replace must mutate the live CodeMirror buffer");

            await editor.SaveAsync();
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            await editor.CloseAsync();

            // 4) Reload via the API the UI itself talks to — proves
            // the buffered replacement survived the save round-trip.
            var json = await Page.EvaluateAsync<JsonElement>(
                @"async () => {
                    const r = await fetch('/api/architectures', { credentials: 'include' });
                    if (!r.ok) throw new Error('fetch failed: ' + r.status);
                    return await r.json();
                }");

            var custom = json.EnumerateArray()
                .First(a => a.GetProperty("isBuiltIn").GetBoolean() == false
                    && a.GetProperty("projects").EnumerateArray()
                        .Any(p => p.GetProperty("nameSuffix").GetString() == unique));

            var project = custom.GetProperty("projects").EnumerateArray()
                .First(p => p.GetProperty("nameSuffix").GetString() == unique);

            // Root folder + file persistence.
            project.GetProperty("folders").EnumerateArray()
                .Select(f => f.GetProperty("name").GetString())
                .Should().Contain("Pages",
                    "the root folder added in the editor must persist");

            var marker = project.GetProperty("files").EnumerateArray()
                .First(f => f.GetProperty("name").GetString() == "Marker.cs");

            var content = marker.GetProperty("content").GetString() ?? string.Empty;
            content.Should().Contain(replacement,
                "find/replace's mutation must persist through save");
            content.Should().NotContain("MARKER_NEEDLE",
                "the original needle must be gone after replace-all");
        }
    }
}
