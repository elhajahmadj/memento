namespace Memento.UxTests.Tests.PageObjects.Selectors
{
    public static class ActionsFeedSelectors
    {
        public const string Toolbar = "actions-feed-toolbar";
        public const string CheckboxSelectAll = "checkbox-select-all-actions";
        public const string ButtonClearSelection = "button-clear-action-selection";
        public const string ButtonDeleteSelected = "button-delete-selected-actions";
        public const string ButtonSaveSelectedAsSharedStep = "button-save-selected-as-shared-step";

        public const string DialogEditActionValue = "dialog-edit-action-value";
        public const string InputEditActionValue = "input-edit-action-value";
        public const string ButtonEditActionSave = "button-edit-action-save";
        public const string ButtonEditActionCancel = "button-edit-action-cancel";

        // Per-row controls. The actions feed renders one button per op
        // (no dropdown menu) so the test ids fan out by index.
        public static string ActionFeedItem(int index) => $"action-feed-item-{index}";
        public static string CheckboxAction(int index) => $"checkbox-action-{index}";
        public static string ButtonRenameAction(int index) => $"button-rename-action-{index}";
        public static string ButtonMoveUpAction(int index) => $"button-move-up-action-{index}";
        public static string ButtonMoveDownAction(int index) => $"button-move-down-action-{index}";
        public static string ButtonDuplicateAction(int index) => $"button-duplicate-action-{index}";
        public static string ButtonInsertBeforeAction(int index) => $"button-insert-before-action-{index}";
        public static string ButtonEditValueAction(int index) => $"button-edit-value-action-{index}";
        public static string ButtonDeleteAction(int index) => $"button-delete-action-{index}";
        public static string ButtonDeleteFromHere(int index) => $"button-delete-from-here-{index}";
        public static string ActionMethodName(int index) => $"action-method-name-{index}";
    }
}
