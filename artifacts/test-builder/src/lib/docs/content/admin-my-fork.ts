import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "admin-my-fork",
    heading: "Admin — My fork (personal push target)",
    intro:
      "Optional per-user, per-project push override. When you set a fork repository here, your Push always targets that personal fork instead of the project's shared upstream — Pull still uses the shared upstream so everyone stays in sync on the same source of truth. The panel lives inside the per-project Git Repos editor dialog (open Admin → Project Git Repos and click Configure / Edit on a row). Only you can see or edit your own fork settings — admins cannot read another user's PAT. The fork PAT is encrypted at rest with the server's PROJECT_SECRETS_KEY and the UI only ever shows the last four characters once saved.",
    walkthrough: [
      "Open Admin → Project Git Repos and click Configure (or Edit) on the project you want to fork.",
      "Scroll to the dashed 'My fork (push target)' panel at the bottom of the dialog.",
      "Pick the Provider (Azure Repos or GitHub) and paste your personal fork's HTTPS clone URL.",
      "Paste your Personal Access Token. The PAT must have push permission on your fork; you do not need write access on the shared upstream.",
      "Click Save fork. A toast confirms 'Personal fork saved — pushes will target your fork'.",
      "On subsequent visits the PAT field shows '•••<last four> (set <date>)' and a Replace button — use Replace to rotate the token.",
      "Click Clear fork to remove the override and revert pushes back to the shared upstream.",
    ],
    fields: [
      { name: "Provider", description: "Azure Repos or GitHub. Determines how the stored PAT is injected into the push URL (Azure Repos uses the PAT as the password against any non-empty username; GitHub uses x-access-token:<pat>@github.com/…)." },
      { name: "Fork repository URL", description: "HTTPS clone URL of your personal fork (placeholder shows the provider-specific shape, e.g. https://github.com/me/myfork.git)." },
      { name: "Personal Access Token", description: "Your PAT with push permission on the fork. Encrypted at rest with PROJECT_SECRETS_KEY; only the last four characters are ever rendered back to the browser." },
      { name: "Replace", description: "Switches the masked PAT display back to a password input so you can rotate the stored token without retyping the URL." },
      { name: "Save fork", description: "Persists the {provider, repoUrl, pat} triple via PUT /api/projects/{name}/my-fork. From the next Push onwards, the push goes to your fork instead of the upstream." },
      { name: "Clear fork", description: "Deletes the override via DELETE /api/projects/{name}/my-fork. Pushes immediately revert to the shared upstream configured by your admin." },
      { name: "Pull always uses the shared upstream", description: "The Pull button on the same Git Repos row is unaffected — it still clones from the project-level configured upstream so contributors stay aligned on the same source of truth, even when each person pushes to their own fork." },
      { name: "Privacy", description: "Your fork settings (including the PAT last-four and set timestamp) are only visible to you — admins managing the project's shared upstream cannot read another user's personal fork PAT." },
    ],
  },
];
