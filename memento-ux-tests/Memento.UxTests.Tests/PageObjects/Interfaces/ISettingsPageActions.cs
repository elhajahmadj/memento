using System.Threading.Tasks;

namespace Memento.UxTests.Tests.PageObjects.Interfaces
{
    public enum SettingsSection
    {
        Appearance, Architectures, Users, Recording,
        Validation, Mocks, ManageProjects, Maintenance, Activity,
    }

    public interface ISettingsPageActions
    {
        Task GotoAsync();
        Task<bool> IsSectionVisibleAsync(SettingsSection section);
        Task<bool> IsLimitedAdminBannerVisibleAsync();

        // Architectures
        Task NewArchitectureAsync();
        Task RenameArchitectureAsync(string id, string newName);
        Task DuplicateArchitectureAsync(string id);
        Task EditArchitectureAsync(string id);
        Task DeleteArchitectureAsync(string id);

        // Users
        Task OpenAddUserDialogAsync();
        Task FillNewUserAsync(string username, string firstName, string lastName, string role);
        Task ConfirmAddUserAsync();

        // Mocks
        Task OpenAddMockAsync();
        Task FillMockAsync(string name, string method, string url, int status, string? body);
        Task SaveMockAsync();

        // Activity
        Task FilterAuditByUserAsync(string username);
        Task FilterAuditByActionAsync(string actionValue);
        Task FilterAuditByProjectAsync(string projectValue);
        Task NextAuditPageAsync();
        Task PrevAuditPageAsync();
        Task ResetAuditAsync();
        Task<int> AuditRowCountAsync();
        Task<bool> IsAuditEmptyAsync();
        Task<bool> IsNextAuditPageEnabledAsync();
        Task ExpandFirstAuditRowAsync();
        Task<bool> IsAnyAuditDetailVisibleAsync();
        Task<string?> FirstAuditUsernameAsync();
    }
}
