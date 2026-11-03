using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    /// <summary>
    /// Drives the full-screen "Edit architecture" dialog (the modal opened
    /// from <see cref="SettingsSelectors.ButtonEditArch"/>). Wraps prompt
    /// dialog handling so callers can add named folders / files / rename
    /// files without manually subscribing to <see cref="IPage.Dialog"/>.
    /// </summary>
    public sealed class ArchitectureEditorPage : PageObjectBase
    {
        public ArchitectureEditorPage(IPage page) : base(page) { }

        public Task ClickAddProjectAsync() =>
            T(SettingsSelectors.ButtonAddProject).ClickAsync();

        public Task SelectProjectAsync(string projectId) =>
            T(SettingsSelectors.ButtonSelectProject(projectId)).ClickAsync();

        public Task FillProjectSuffixAsync(string suffix) =>
            T(SettingsSelectors.InputProjectSuffix).FillAsync(suffix);

        public async Task ToggleTestsProjectAsync()
        {
            // Radix Switch — clicking flips the value.
            await T(SettingsSelectors.SwitchTestsProject).ClickAsync();
        }

        public async Task RemoveProjectAsync()
        {
            // Trips a window.confirm prompt — accept it.
            await AcceptNextDialogAsync();
            await T(SettingsSelectors.ButtonRemoveProject).ClickAsync();
        }

        public async Task AddRootFolderAsync(string name)
        {
            await AcceptNextDialogAsync(name);
            await T(SettingsSelectors.ButtonAddRootFolder).ClickAsync();
        }

        public async Task AddRootFileAsync(string name)
        {
            await AcceptNextDialogAsync(name);
            await T(SettingsSelectors.ButtonAddRootFile).ClickAsync();
        }

        public Task SelectFileAsync(string folderPathSlash, string fileName) =>
            T(SettingsSelectors.TreeFile(folderPathSlash, fileName)).ClickAsync();

        /// <summary>
        /// Add a folder inside an existing folder by clicking the
        /// hover-revealed "New folder" affordance on that folder's row.
        /// The action buttons live behind a <c>group-hover</c> CSS rule
        /// so we click with <c>Force</c> to bypass the visibility gate.
        /// </summary>
        public async Task AddNestedFolderUnderAsync(string parentPathSlash, string name)
        {
            await EnsureFolderExpandedAsync(parentPathSlash);
            await AcceptNextDialogAsync(name);
            var row = T(SettingsSelectors.TreeFolder(parentPathSlash))
                .Locator("xpath=..");
            await row.GetByTitle("New folder")
                .ClickAsync(new() { Force = true });
        }

        public async Task AddNestedFileUnderAsync(string parentPathSlash, string fileName)
        {
            await EnsureFolderExpandedAsync(parentPathSlash);
            await AcceptNextDialogAsync(fileName);
            var row = T(SettingsSelectors.TreeFolder(parentPathSlash))
                .Locator("xpath=..");
            await row.GetByTitle("New file")
                .ClickAsync(new() { Force = true });
        }

        public async Task DeleteFileAsync(string folderPathSlash, string fileName)
        {
            await AcceptNextDialogAsync();    // confirm("Delete file ...?")
            var row = T(SettingsSelectors.TreeFile(folderPathSlash, fileName))
                .Locator("xpath=..");
            await row.GetByTitle("Delete file")
                .ClickAsync(new() { Force = true });
        }

        /// <summary>
        /// Delete a folder via its hover-revealed "Delete folder" button.
        /// The folder row's button hangs off the row containing the
        /// <c>tree-folder-{path}</c> testid.
        /// </summary>
        public async Task DeleteFolderAsync(string folderPathSlash)
        {
            await AcceptNextDialogAsync();    // confirm("Delete folder ...?")
            var row = T(SettingsSelectors.TreeFolder(folderPathSlash))
                .Locator("xpath=..");
            await row.GetByTitle("Delete folder")
                .ClickAsync(new() { Force = true });
        }

        public async Task RenameFileAsync(
            string folderPathSlash,
            string oldFileName,
            string newFileName)
        {
            await AcceptNextDialogAsync(newFileName);
            var row = T(SettingsSelectors.TreeFile(folderPathSlash, oldFileName))
                .Locator("xpath=..");
            await row.GetByTitle("Rename")
                .ClickAsync(new() { Force = true });
        }

        private async Task EnsureFolderExpandedAsync(string folderPathSlash)
        {
            // The tree-folder button doubles as the expand toggle.
            // Children only render when the folder is open; we look for
            // any descendant tree-folder testid that starts with our
            // path's prefix as a presence proxy and click to open when
            // it's missing. Click is idempotent for our purposes — the
            // hover-revealed action buttons hang off the same row either
            // way.
            var hasChild = await Page.Locator(
                $"[data-testid^='tree-folder-{folderPathSlash}/'], " +
                $"[data-testid^='tree-file-{folderPathSlash}/']").CountAsync();
            if (hasChild == 0)
            {
                await T(SettingsSelectors.TreeFolder(folderPathSlash)).ClickAsync();
            }
        }

        public Task ToggleEditFileAsync() =>
            T(SettingsSelectors.ButtonToggleEditArchFile).ClickAsync();

        /// <summary>Replace the CodeMirror buffer's contents.</summary>
        public async Task ReplaceFileContentAsync(string content)
        {
            // CodeMirror renders a contenteditable .cm-content inside the
            // tagged textarea wrapper. Select-all then type to replace.
            var content_ = T(SettingsSelectors.TextareaArchFile).Locator(".cm-content");
            await content_.ClickAsync();
            await Page.Keyboard.PressAsync("ControlOrMeta+a");
            await Page.Keyboard.PressAsync("Delete");
            await Page.Keyboard.TypeAsync(content);
        }

        /// <summary>
        /// Open the CodeMirror find/replace panel (<c>Mod+Alt+f</c>) and
        /// run a single global "replace all" against the active arch
        /// file. Asserts the panel actually surfaced before driving it
        /// — if the editor isn't in edit mode, the panel never opens
        /// and the test would otherwise hang against an invisible
        /// input.
        /// </summary>
        public async Task FindReplaceInFileAsync(string find, string replace)
        {
            var content = T(SettingsSelectors.TextareaArchFile).Locator(".cm-content");
            await content.ClickAsync();
            // CM6's "replace" command is bound to Mod-Alt-f.
            await Page.Keyboard.PressAsync("ControlOrMeta+Alt+F");
            var panel = Page.Locator(".cm-panel.cm-search");
            await panel.WaitForAsync(new() { Timeout = 5000 });
            // The panel has two inputs (search, replace) — main is the
            // first textbox by role inside the panel; replace is the
            // one with placeholder "Replace".
            await panel.Locator("input[main-field], input[name='search']")
                .First.FillAsync(find);
            await panel.Locator("input[placeholder='Replace']")
                .First.FillAsync(replace);
            // Click "replace all" — CM uses the literal label.
            await panel.GetByRole(AriaRole.Button,
                new() { NameRegex = new System.Text.RegularExpressions.Regex(
                    "(?i)replace all") }).ClickAsync();
            // Close the panel so subsequent typing lands in the buffer.
            await Page.Keyboard.PressAsync("Escape");
        }

        /// <summary>Read the active arch file's CodeMirror buffer.</summary>
        public async Task<string> ReadFileContentAsync()
        {
            var content = T(SettingsSelectors.TextareaArchFile).Locator(".cm-content");
            await content.WaitForAsync(new() { Timeout = 5000 });
            return await content.InnerTextAsync();
        }

        public Task SaveAsync() =>
            T(SettingsSelectors.ButtonSaveArch).ClickAsync();

        public async Task CloseAsync()
        {
            // The Close button is plain text inside the dialog header;
            // grab it by role for resilience to className churn.
            await Page.GetByRole(AriaRole.Button, new() { Name = "Close" }).First.ClickAsync();
        }

        private Task AcceptNextDialogAsync(string? value = null)
        {
            var tcs = new TaskCompletionSource<bool>();
            void Handler(object? _, IDialog dialog)
            {
                _ = value is null
                    ? dialog.AcceptAsync()
                    : dialog.AcceptAsync(value);
                Page.Dialog -= Handler;
                tcs.TrySetResult(true);
            }
            Page.Dialog += Handler;
            return Task.CompletedTask;
        }
    }
}
