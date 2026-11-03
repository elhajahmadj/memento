using System.Threading.Tasks;

namespace Memento.UxTests.Tests.PageObjects.Interfaces
{
    public interface IActionsFeedActions
    {
        Task<int> CountVisibleAsync();
        Task SelectAllAsync();
        Task SelectRowAsync(int index);
        Task DeleteSelectedAsync();
        Task EditValueAsync(int index, string newValue);
        Task RenameAsync(int index, string newName);
        Task InsertAssertionAboveAsync(int index);
        Task InsertAssertionBelowAsync(int index);
        Task DuplicateAsync(int index);
        Task MoveUpAsync(int index);
        Task MoveDownAsync(int index);
        Task DeleteAsync(int index);
        Task UndoDeleteAsync(int index);
        Task<bool> HasRowAsync(int index);
    }
}
