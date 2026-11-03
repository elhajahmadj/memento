using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    public sealed class SettingsPage : PageObjectBase, ISettingsPageActions
    {
        public SettingsPage(IPage page) : base(page) { }

        public async Task GotoAsync() =>
            await Page.GotoAsync(MementoSettings.BaseUrl + "/settings");

        public async Task<bool> IsSectionVisibleAsync(SettingsSection section)
        {
            var id = section switch
            {
                SettingsSection.Appearance      => SettingsSelectors.SectionAppearance,
                SettingsSection.Architectures   => SettingsSelectors.SectionArchitectures,
                SettingsSection.Users           => SettingsSelectors.SectionUsers,
                SettingsSection.Recording       => SettingsSelectors.SectionRecording,
                SettingsSection.Validation      => SettingsSelectors.SectionValidation,
                SettingsSection.Mocks           => SettingsSelectors.SectionMocks,
                SettingsSection.ManageProjects  => SettingsSelectors.SectionManageProjects,
                SettingsSection.Maintenance     => SettingsSelectors.SectionMaintenance,
                SettingsSection.Activity        => SettingsSelectors.SectionActivity,
                _ => SettingsSelectors.SectionAppearance,
            };
            return await T(id).IsVisibleAsync();
        }

        public async Task<bool> IsLimitedAdminBannerVisibleAsync() =>
            await T(SettingsSelectors.BannerLimitedAdminSettings).IsVisibleAsync();

        public async Task NewArchitectureAsync() =>
            await T(SettingsSelectors.ButtonNewArchitecture).ClickAsync();

        public async Task RenameArchitectureAsync(string id, string newName)
        {
            await T(SettingsSelectors.ButtonRenameArch(id)).ClickAsync();
            await T(SettingsSelectors.InputRenameArch).FillAsync(newName);
            await T(SettingsSelectors.ButtonConfirmRenameArch).ClickAsync();
        }

        public async Task DuplicateArchitectureAsync(string id) =>
            await T(SettingsSelectors.ButtonDuplicateArch(id)).ClickAsync();

        public async Task EditArchitectureAsync(string id) =>
            await T(SettingsSelectors.ButtonEditArch(id)).ClickAsync();

        public async Task DeleteArchitectureAsync(string id)
        {
            await T(SettingsSelectors.ButtonDeleteArch(id)).ClickAsync();
            await T(SettingsSelectors.ButtonConfirmDeleteArch).ClickAsync();
        }

        /// <summary>
        /// Upload a JSON architecture file via the hidden file input
        /// (<c>input-import-architecture</c>). The input is
        /// <c>display:none</c> but Playwright can drive hidden inputs
        /// via <see cref="ILocator.SetInputFilesAsync(FilePayload, LocatorSetInputFilesOptions?)"/>.
        /// </summary>
        public async Task ImportArchitectureJsonAsync(string fileName, string jsonBody)
        {
            await T(SettingsSelectors.InputImportArchitecture).SetInputFilesAsync(
                new FilePayload
                {
                    Name = fileName,
                    MimeType = "application/json",
                    Buffer = System.Text.Encoding.UTF8.GetBytes(jsonBody),
                });
        }

        /// <summary>
        /// Simulate dragging-and-dropping one or more JSON files onto an
        /// element identified by data-testid. Builds a real
        /// <c>DataTransfer</c> in the page, attaches synthetic
        /// <c>File</c>s to it, then dispatches a bubbling <c>drop</c>
        /// event so the React <c>onDrop</c> handler runs end-to-end —
        /// the same code path a real user's drag-from-OS would hit
        /// (<c>handleDrop</c> / <c>handleDialogDrop</c> in
        /// <c>use-architecture-import.ts</c>). Playwright cannot
        /// originate a true OS-level file drag, so a synthesized
        /// <c>DataTransfer</c> is the canonical way to cover this path.
        /// </summary>
        public async Task DropJsonFilesAsync(
            string targetTestId,
            params (string Name, string Body)[] files)
        {
            var payload = files
                .Select(f => new { name = f.Name, body = f.Body })
                .ToArray();
            var dataTransfer = await Page.EvaluateHandleAsync(
                @"(specs) => {
                    const dt = new DataTransfer();
                    for (const { name, body } of specs) {
                        dt.items.add(new File([body], name, { type: 'application/json' }));
                    }
                    return dt;
                }",
                payload);
            await T(targetTestId).DispatchEventAsync(
                "drop",
                new Dictionary<string, object> { ["dataTransfer"] = dataTransfer });
        }

        public async Task OpenAddUserDialogAsync() =>
            await T(SettingsSelectors.ButtonAddUser).ClickAsync();

        public async Task FillNewUserAsync(string username, string firstName, string lastName, string role)
        {
            await T(SettingsSelectors.InputNewUserUsername).FillAsync(username);
            await T(SettingsSelectors.InputNewUserFirstName).FillAsync(firstName);
            await T(SettingsSelectors.InputNewUserLastName).FillAsync(lastName);
            await T(SettingsSelectors.SelectNewUserRole).SelectOptionAsync(role);
        }

        public async Task ConfirmAddUserAsync() =>
            await T(SettingsSelectors.ButtonConfirmAddUser).ClickAsync();

        public async Task OpenAddMockAsync() =>
            await T(SettingsSelectors.ButtonAddMock).ClickAsync();

        public async Task FillMockAsync(string name, string method, string url, int status, string? body)
        {
            await T(SettingsSelectors.InputMockName).FillAsync(name);
            await T(SettingsSelectors.SelectMockMethod).SelectOptionAsync(method);
            await T(SettingsSelectors.InputMockUrl).FillAsync(url);
            await T(SettingsSelectors.InputMockStatus).FillAsync(status.ToString(CultureInfo.InvariantCulture));
            if (!string.IsNullOrEmpty(body))
                await T(SettingsSelectors.InputMockBody).FillAsync(body);
        }

        public async Task SaveMockAsync() =>
            await T(SettingsSelectors.ButtonSaveMock).ClickAsync();

        public async Task FilterAuditByUserAsync(string username)
        {
            await T(SettingsSelectors.InputAuditUser).FillAsync(username);
            await T(SettingsSelectors.ButtonAuditApplyUser).ClickAsync();
        }

        public async Task FilterAuditByActionAsync(string actionLabel) =>
            await PickRadixOptionAsync(SettingsSelectors.SelectAuditAction, actionLabel);

        public async Task FilterAuditByProjectAsync(string projectLabel) =>
            await PickRadixOptionAsync(SettingsSelectors.SelectAuditProject, projectLabel);

        // Radix-Select trigger isn't a native <select>; selectOption()
        // would throw, so emulate the keyboard interaction the user
        // would do: click the trigger, then click the option by name.
        private async Task PickRadixOptionAsync(string triggerTestId, string optionLabel)
        {
            await T(triggerTestId).ClickAsync();
            await Page.GetByRole(AriaRole.Option, new() { Name = optionLabel })
                .First.ClickAsync();
        }

        public async Task NextAuditPageAsync() =>
            await T(SettingsSelectors.ButtonAuditNext).ClickAsync();

        public async Task PrevAuditPageAsync() =>
            await T(SettingsSelectors.ButtonAuditPrev).ClickAsync();

        public async Task ResetAuditAsync() =>
            await T(SettingsSelectors.ButtonAuditReset).ClickAsync();

        public async Task<int> AuditRowCountAsync() =>
            await T(SettingsSelectors.SectionActivityBody)
                .Locator("[data-testid^=\"row-audit-\"]").CountAsync();

        public async Task<bool> IsAuditEmptyAsync() =>
            await T(SettingsSelectors.AuditEmpty).IsVisibleAsync();

        public async Task<bool> IsNextAuditPageEnabledAsync() =>
            await T(SettingsSelectors.ButtonAuditNext).IsEnabledAsync();

        public async Task ExpandFirstAuditRowAsync()
        {
            var first = T(SettingsSelectors.SectionActivityBody)
                .Locator("[data-testid^=\"row-audit-\"]").First;
            await first.ClickAsync();
        }

        public async Task<bool> IsAnyAuditDetailVisibleAsync() =>
            await T(SettingsSelectors.SectionActivityBody)
                .Locator("[data-testid^=\"details-audit-\"]").First.IsVisibleAsync();

        public async Task<string?> FirstAuditUsernameAsync()
        {
            var first = T(SettingsSelectors.SectionActivityBody)
                .Locator("[data-testid^=\"row-audit-\"]").First;
            if (await first.CountAsync() == 0) return null;
            // Username is in the third <td> (after expand chevron + when).
            var cells = first.Locator("td");
            if (await cells.CountAsync() < 3) return null;
            return (await cells.Nth(2).InnerTextAsync()).Trim();
        }
    }
}
