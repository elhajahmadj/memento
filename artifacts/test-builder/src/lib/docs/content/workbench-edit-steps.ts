import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-edit-steps",
    heading: "Workbench — Edit recorded steps",
    intro:
      "Every captured action in the recorded-actions feed has a per-row menu so you can fix mistakes without going back to the recorder. You can edit the typed value, rename or delete a step, insert a new assertion above or below it, duplicate it, move it up or down, or undo a deletion — all without re-recording. Bulk delete is available from the feed's selection toolbar. Every change is audit-logged as a `recorded_action_edit` event with the specific operation (`edit-action-value`, `move-action`, `duplicate-action`, `delete-action`, `undelete-action`, `insert-assertion`, …) so SDETs can see exactly what changed during review.",
    walkthrough: [
      "Open the Workbench for a project that already has at least one recorded suite.",
      "Find the action you want to change in the recorded-actions feed and click its row menu (…).",
      "Pick the operation: Edit value, Rename, Insert assertion above / below, Duplicate, Move up / Move down, or Delete.",
      "For 'Edit value', the Edit Value dialog pre-fills the current literal so you can tweak it inline; press Save to commit.",
      "Use the row checkboxes to select multiple actions at once and click 'Delete selected' in the toolbar to remove them in one shot.",
      "Click 'Undo' on a deleted row to restore it (a `undelete-action` audit event is recorded).",
      "Save (admins) or 'Request SDET approval' (users) to ship the edited recording the same way you would a fresh capture.",
    ],
    fields: [
      { name: "Row menu (…)", description: "Per-action menu exposing edit / insert assertion / duplicate / move / delete operations." },
      { name: "Edit Value dialog", description: "Modal that lets you change the literal a fill / type action sends without re-recording." },
      { name: "Insert assertion above / below", description: "Opens the Add-assertion dialog and inserts the new assertion at the chosen position." },
      { name: "Duplicate", description: "Copies the action immediately below the selected row, useful for 'do the same thing twice' flows." },
      { name: "Move up / down", description: "Reorders the action by swapping with its neighbor; the generated code is regenerated to match." },
      { name: "Delete / Undo", description: "Removes the action from the recording. Deleted rows can be restored from the same row menu until you save." },
      { name: "Bulk delete", description: "Select rows via the row checkboxes and use the toolbar's 'Delete selected' button to remove them in one shot." },
      { name: "Audit trail", description: "Every operation is recorded as a `recorded_action_edit` audit event tagged with the specific op (`edit-action-value`, `move-action`, `duplicate-action`, `delete-action`, `undelete-action`, `insert-assertion`, …)." },
    ],
  },
];
