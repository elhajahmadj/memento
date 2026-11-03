import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-branches",
    heading: "Workbench — Branches in the workstation",
    intro:
      "The Explorer panel header carries a branch picker next to the 'Explorer' label so you can see which local branch the workstation is on, switch to another local branch, or create a new one — without leaving the workbench. All branch operations are local: switching never auto-pushes, and creating a branch does not push it either. Pull and Push are still triggered from Admin → Project Git Repos (Pull from / Push to <provider>). The dropdown is hidden completely for projects that are not under Git (the server reports no Git working copy for the project).",
    walkthrough: [
      "Open the Workbench for any project under Git. The Explorer header (top-left of the workbench) shows a small `branch-icon` button labelled with the current branch.",
      "Click the branch button to open the menu. The 'Local branches' section lists every local branch with a check next to the current one; click any other branch row to switch to it.",
      "If the working copy has uncommitted changes, switching pops a 'Discard uncommitted changes?' confirmation — Cancel keeps you on the current branch, 'Discard and switch' force-checks-out the target branch and discards the uncommitted edits.",
      "To create a new branch, click 'Create new branch…' at the bottom of the menu, type a name in the inline input, and press Enter (or click Create). The new branch is created off the current branch and immediately checked out.",
      "After any switch or create, the file tree refreshes automatically to reflect the new branch's contents. A toast confirms the operation.",
      "Nothing is auto-pushed. To publish a newly created branch (or commits on it) to the remote, go to Admin → Project Git Repos and use Push to <provider>.",
    ],
    fields: [
      { name: "Branch button (closed)", description: "Trigger in the Explorer header showing the currently checked-out branch name in monospace, with a chevron. Title attribute reads 'Current branch: <name>'. Hidden when the project is not a Git working copy." },
      { name: "Local branches list", description: "Every local branch returned by GET /api/projects/{name}/branches, in the order the server reports. A check mark marks the current branch; clicking any other row issues a checkout." },
      { name: "Create new branch…", description: "Opens an inline input at the bottom of the menu. Enter to submit, Escape to cancel. The new branch is created off the current branch via POST /api/projects/{name}/branches with `checkout: true`." },
      { name: "Dirty-working-copy confirmation", description: "If checkout returns errorCode `dirty_working_copy`, the dropdown pops an AlertDialog ('Discard uncommitted changes?'). Confirming retries the checkout with `force: true`; cancelling leaves the working copy untouched." },
      { name: "Inline errors", description: "Server errors (invalid name, branch already exists, dirty working copy without force, etc.) surface inline beneath the input — not as toasts — so the message stays next to the field that produced it." },
      { name: "Auto-refresh", description: "After a successful switch or create, the dropdown invalidates the branches query and the project tree query so the file viewer immediately reflects the new branch's contents." },
      { name: "No auto-push", description: "Switching to a branch or creating a new one never pushes to the remote. To publish a branch, use Push to <provider> on Admin → Project Git Repos." },
    ],
  },
];
