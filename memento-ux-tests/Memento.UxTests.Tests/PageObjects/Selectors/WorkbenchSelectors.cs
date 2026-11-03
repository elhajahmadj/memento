namespace Memento.UxTests.Tests.PageObjects.Selectors
{
    public static class WorkbenchSelectors
    {
        // Toolbar
        public const string ButtonStartRecording = "button-start-recording";
        public const string ButtonStopRecording = "button-stop-recording";
        public const string ButtonSaveRecording = "button-save-recording";
        public const string ButtonRequestApproval = "button-request-approval";
        public const string ButtonDiscardRecording = "button-discard-recording";
        public const string ButtonHome = "button-home";
        public const string ButtonDownloadZip = "button-download-zip";
        public const string ButtonOpenInVscode = "button-open-in-vscode";
        public const string ButtonWorkbenchActionsMenu = "button-workbench-actions-menu";
        public const string ButtonOpenValidation = "button-open-validation";
        public const string ButtonGeneratePipelineFile = "button-generate-pipeline-file";
        public const string TextRecordingTarget = "text-recording-target";

        // Right panel actions
        public const string ButtonAddAssertion = "button-add-assertion";
        public const string ButtonAddApiCheck = "button-add-api-check";
        public const string ButtonAddWait = "button-add-wait";
        public const string ButtonAddTestClass = "button-add-test-class";
        public const string ButtonCaptureLogin = "button-capture-login";
        public const string ButtonInsertSharedStep = "button-insert-shared-step";
        public const string ButtonValidateSession = "button-validate-session";

        // Recording canvas
        public const string RecordingCanvas = "recording-canvas";
        public const string RecordingCanvasPopout = "recording-canvas-popout";
        public const string ButtonPopoutRecording = "button-popout-recording";
        public const string ButtonClosePopoutRecording = "button-close-popout-recording";
        public const string TextRecordingViewport = "text-recording-viewport";
        public const string TextRecordingStopped = "text-recording-stopped";

        // Validation panel
        public const string SheetValidationPanel = "sheet-validation-panel";
        public const string ButtonValidateAll = "button-validate-all";
        public const string BadgeUnsaved = "badge-unsaved";

        // File tree
        public static string TreeNode(string relPath) =>
            $"tree-node-{relPath.Replace('/', '-')}";
        public const string ButtonEditFile = "button-edit-file";
        public const string ButtonCancelEdit = "button-cancel-edit";
        public const string ButtonSaveEdit = "button-save-edit";
        public const string ButtonCopyCode = "button-copy-code";
        public const string TextareaFileEditor = "textarea-file-editor";

        // History panel
        public const string RecordingHistoryPanel = "recording-history-panel";
        public const string ButtonToggleHistory = "button-toggle-history";
        public const string BadgeHistoryCount = "badge-history-count";
        public const string TextHistoryEmpty = "text-history-empty";
    }
}
