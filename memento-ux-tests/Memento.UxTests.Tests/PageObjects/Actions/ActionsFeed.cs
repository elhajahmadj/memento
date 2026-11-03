using System.Threading.Tasks;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    /// <summary>
    /// Wraps the recorded-actions list in the workbench. Each row exposes
    /// its op buttons inline (no dropdown menu) — see actions-feed.tsx.
    /// We address them through the stable per-index data-testids so the
    /// suite is resilient to the React tree being rebuilt as new actions
    /// stream in.
    /// </summary>
    public sealed class ActionsFeed : PageObjectBase, IActionsFeedActions
    {
        public ActionsFeed(IPage page) : base(page) { }

        public ILocator Item(int index) => T(ActionsFeedSelectors.ActionFeedItem(index));

        public async Task<int> CountVisibleAsync() =>
            await Page.Locator("[data-testid^=\"action-feed-item-\"]").CountAsync();

        public async Task<bool> HasRowAsync(int index) =>
            await Item(index).CountAsync() > 0;

        public async Task SelectAllAsync() =>
            await T(ActionsFeedSelectors.CheckboxSelectAll).ClickAsync();

        public async Task SelectRowAsync(int index) =>
            await T(ActionsFeedSelectors.CheckboxAction(index)).ClickAsync();

        public async Task DeleteSelectedAsync() =>
            await T(ActionsFeedSelectors.ButtonDeleteSelected).ClickAsync();

        public async Task EditValueAsync(int index, string newValue)
        {
            await T(ActionsFeedSelectors.ButtonEditValueAction(index)).ClickAsync();
            await T(ActionsFeedSelectors.InputEditActionValue).FillAsync(newValue);
            await T(ActionsFeedSelectors.ButtonEditActionSave).ClickAsync();
        }

        public async Task RenameAsync(int index, string newName)
        {
            await T(ActionsFeedSelectors.ButtonRenameAction(index)).ClickAsync();
            // Rename uses the shared rename-dialog (input-rename + button-confirm-rename).
            await T("input-rename").FillAsync(newName);
            await T("button-confirm-rename").ClickAsync();
        }

        public async Task InsertAssertionAboveAsync(int index) =>
            await T(ActionsFeedSelectors.ButtonInsertBeforeAction(index)).ClickAsync();

        /// <summary>
        /// "Insert assertion below" is implemented by inserting before
        /// the next row. Falls back to the toolbar Add-assertion button
        /// when this is the last row.
        /// </summary>
        public async Task InsertAssertionBelowAsync(int index)
        {
            var below = T(ActionsFeedSelectors.ButtonInsertBeforeAction(index + 1));
            if (await below.CountAsync() > 0)
            {
                await below.ClickAsync();
                return;
            }
            await T(WorkbenchSelectors.ButtonAddAssertion).ClickAsync();
        }

        public async Task DuplicateAsync(int index) =>
            await T(ActionsFeedSelectors.ButtonDuplicateAction(index)).ClickAsync();

        public async Task MoveUpAsync(int index) =>
            await T(ActionsFeedSelectors.ButtonMoveUpAction(index)).ClickAsync();

        public async Task MoveDownAsync(int index) =>
            await T(ActionsFeedSelectors.ButtonMoveDownAction(index)).ClickAsync();

        public async Task DeleteAsync(int index) =>
            await T(ActionsFeedSelectors.ButtonDeleteAction(index)).ClickAsync();

        public async Task UndoDeleteAsync(int index)
        {
            // Toast-driven undo — surfaces an "Undo" button on the
            // Sonner toast for ~6 seconds.
            _ = index;
            var undo = Page.GetByRole(AriaRole.Button, new() { Name = "Undo" });
            if (await undo.CountAsync() > 0) await undo.First.ClickAsync();
        }
    }
}
