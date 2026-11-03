namespace Memento.UxTests.Tests.PageObjects.Selectors
{
    /// <summary>
    /// Selectors for the 12-kind no-code assertion catalog dialog.
    /// </summary>
    public static class AddAssertionDialogSelectors
    {
        public const string Dialog = "dialog-add-assertion";

        // Kind radios — matches the assertKind enum in
        // artifacts/test-builder/src/features/workbench/.../add-assertion-dialog.tsx.
        public const string RadioElementVisible = "radio-assert-element-visible";
        public const string RadioElementHidden = "radio-assert-element-hidden";
        public const string RadioElementCountEquals = "radio-assert-element-count-equals";
        public const string RadioAttributeEquals = "radio-assert-attribute-equals";
        public const string RadioValueEquals = "radio-assert-value-equals";
        public const string RadioElementHasText = "radio-assert-element-has-text";
        public const string RadioUrlContains = "radio-assert-url-contains";
        public const string RadioUrlEquals = "radio-assert-url-equals";
        public const string RadioResponseStatus = "radio-assert-response-status";
        public const string RadioAccessibility = "radio-assert-accessibility";
        public const string RadioVisualBaseline = "radio-assert-visual-baseline";

        // Inputs
        public const string InputSelector = "input-assert-selector";
        public const string InputCount = "input-assert-count";
        public const string InputAttribute = "input-assert-attribute";
        public const string InputAttrValue = "input-assert-attr-value";
        public const string InputValue = "input-assert-value";
        public const string InputText = "input-assert-text";
        public const string InputUrl = "input-assert-url";
        public const string InputStatusCode = "input-assert-status-code";
        public const string InputVisualName = "input-visual-name";
        public const string InputVisualThreshold = "input-visual-threshold";
        public const string SelectAxeImpact = "select-axe-impact";

        public const string ButtonAdd = "button-assertion-add";
        public const string ButtonCancel = "button-assertion-cancel";
    }
}
