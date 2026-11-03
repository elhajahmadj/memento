namespace Memento.UxTests.Tests.PageObjects.Selectors
{
    public static class SettingsSelectors
    {
        // Section headers — id matches CollapsibleSection's data-testid
        // pattern `settings-section-<id>`.
        public const string SectionAppearance = "settings-section-appearance";
        public const string SectionArchitectures = "settings-section-architectures";
        public const string SectionUsers = "settings-section-users";
        public const string SectionRecording = "settings-section-recording";
        public const string SectionValidation = "settings-section-validation";
        public const string SectionMocks = "settings-section-mocks";
        public const string SectionManageProjects = "settings-section-manage-projects";
        public const string SectionMaintenance = "settings-section-maintenance";
        public const string SectionActivity = "settings-section-activity";

        public const string BannerLimitedAdminSettings = "banner-limited-admin-settings";

        // Architecture management
        public const string ButtonNewArchitecture = "button-new-architecture";
        public const string ButtonImportArchitecture = "button-import-architecture";
        public const string InputImportArchitecture = "input-import-architecture";
        public const string DropzoneArchitectures = "dropzone-architectures";
        public const string DialogImportResults = "dialog-import-results";
        public const string HintArchitecturesEmpty = "hint-architectures-empty";
        public const string InputRenameArch = "input-rename-arch";
        public const string ButtonConfirmRenameArch = "button-confirm-rename-arch";
        public const string ButtonConfirmDeleteArch = "button-confirm-delete-arch";
        public static string RowArch(string id) => $"row-arch-{id}";
        public static string ButtonRenameArch(string id) => $"button-rename-arch-{id}";
        public static string ButtonDuplicateArch(string id) => $"button-duplicate-arch-{id}";
        public static string ButtonExportArch(string id) => $"button-export-arch-{id}";
        public static string ButtonEditArch(string id) => $"button-edit-arch-{id}";
        public static string ButtonDeleteArch(string id) => $"button-delete-arch-{id}";

        // Architecture editor (full-screen dialog)
        public const string ButtonSaveArch = "button-save-arch";
        public const string ButtonAddProject = "button-add-project";
        public const string ButtonRemoveProject = "button-remove-project";
        public const string InputProjectSuffix = "input-project-suffix";
        public const string SwitchTestsProject = "switch-tests-project";
        public const string ButtonAddRootFolder = "button-add-root-folder";
        public const string ButtonAddRootFile = "button-add-root-file";
        public const string ButtonToggleEditArchFile = "button-toggle-edit-arch-file";
        public const string TextareaArchFile = "textarea-arch-file";
        public static string ButtonSelectProject(string id) => $"button-select-project-{id}";
        public static string TreeFile(string folderPathSlash, string fileName) =>
            string.IsNullOrEmpty(folderPathSlash)
                ? $"tree-file-{fileName}"
                : $"tree-file-{folderPathSlash}/{fileName}";
        public static string TreeFolder(string folderPathSlash) =>
            $"tree-folder-{folderPathSlash}";

        // Users
        public const string ButtonAddUser = "button-add-user";

        // Add user dialog
        public const string InputNewUserUsername = "input-new-user-username";
        public const string InputNewUserFirstName = "input-new-user-first-name";
        public const string InputNewUserLastName = "input-new-user-last-name";
        public const string SelectNewUserRole = "select-new-user-role";
        public const string ButtonConfirmAddUser = "button-confirm-add-user";
        public const string ButtonCancelAddUser = "button-cancel-add-user";

        // Mocks
        public const string ButtonAddMock = "button-add-mock";
        public const string DialogEditMock = "dialog-edit-mock";
        public const string InputMockName = "input-mock-name";
        public const string SelectMockMethod = "select-mock-method";
        public const string InputMockUrl = "input-mock-url";
        public const string InputMockStatus = "input-mock-status";
        public const string InputMockBody = "input-mock-body";
        public const string SwitchMockEnabledEdit = "switch-mock-enabled-edit";
        public const string ButtonSaveMock = "button-save-mock";
        public const string ButtonCancelMock = "button-cancel-mock";
        public const string MocksNoProject = "mocks-no-project";
        public const string TextNoMocks = "text-no-mocks";

        // Activity
        public const string SectionActivityBody = "section-activity";
        public const string AuditEmpty = "audit-empty";
        public const string InputAuditUser = "input-audit-user";
        public const string SelectAuditAction = "select-audit-action";
        public const string SelectAuditProject = "select-audit-project";
        public const string ButtonAuditApplyUser = "button-audit-apply-user";
        public const string ButtonAuditNext = "button-audit-next";
        public const string ButtonAuditPrev = "button-audit-prev";
        public const string ButtonAuditReset = "button-audit-reset";
        public static string RowAudit(string id) => $"row-audit-{id}";
        public static string DetailsAudit(string id) => $"details-audit-{id}";
    }
}
