# Role × Page documentation matrix

**Auto-generated** by `artifacts/test-builder/scripts/gen-role-page-matrix.ts` from `artifacts/test-builder/src/lib/docs/matrix.ts`. Do not edit by hand — run `pnpm --filter @workspace/test-builder run docs:matrix` after changing the matrix module.

This table is the single source of truth for: which sections show up in the `/documentation` sidebar per role, the auto-generated 'Permissions' note rendered on each section, and the role/route coverage check enforced by the Playwright screenshot harness in `artifacts/test-builder/e2e-docs/`.

| Section | Route | Settings sub-section | Admin | Limited Admin | User | Guest | Screenshot key |
|---|---|---|:---:|:---:|:---:|:---:|---|
| `landing` — Landing page (signed out) | `/` | — | ✅ | ✅ | ✅ | — | `landing.jpg` |
| `dashboard` — Home — post-login landing | `/` | — | ✅ | ✅ | ✅ | — | `home.jpg` |
| `home` — Projects | `/projects` | — | ✅ | ✅ | ✅ | — | `home.jpg` |
| `workbench` — Workbench — Recording | `/workbench` | — | ✅ | ✅ | ✅ | — | `workbench.jpg` |
| `workbench-generate-pipeline-file` — Workbench — Generate Pipeline File | `/workbench` | — | ✅ | ✅ | ✅ | — | `workbench.jpg` |
| `workbench-edit-steps` — Workbench — Edit recorded steps | `/workbench` | — | ✅ | ✅ | ✅ | — | `workbench-edit-steps.jpg` |
| `workbench-assertions` — Workbench — UI assertion catalog | `/workbench` | — | ✅ | ✅ | ✅ | — | `workbench-assertions.jpg` |
| `workbench-run-all` — Workbench — Run all tests | `/workbench` | — | ✅ | ✅ | ✅ | — | `workbench-run-all.jpg` |
| `workbench-api-checks` — Workbench — API checks & route mocks | `/workbench` | — | ✅ | ✅ | ✅ | — | `workbench-api-checks.jpg` |
| `workbench-api-solutions` — Workbench — API solutions (multi-language) | `/workbench` | — | ✅ | ✅ | ✅ | — | `workbench.jpg` |
| `workbench-api-build-test-python` — Workbench — Build Test (Python) | `/workbench` | — | ✅ | — | — | — | `workbench-api-build-test-python.jpg` |
| `workbench-api-build-test-nodejs` — Workbench — Build Test (Node.js) | `/workbench` | — | ✅ | — | — | — | `workbench-api-build-test-nodejs.jpg` |
| `workbench-api-build-test-java` — Workbench — Build Test (Java) | `/workbench` | — | ✅ | — | — | — | `workbench-api-build-test-java.jpg` |
| `workbench-accessibility` — Workbench — Accessibility scans | `/workbench` | — | ✅ | ✅ | ✅ | — | `workbench-accessibility.jpg` |
| `workbench-visual-baseline` — Workbench — Visual baselines | `/workbench` | — | ✅ | ✅ | ✅ | — | `workbench-visual-baseline.jpg` |
| `workbench-open-browser` — Workbench — Open Browser (hand-prep before recording) | `/workbench` | — | ✅ | ✅ | ✅ | — | `workbench.jpg` |
| `workbench-keep-browser-open` — Workbench — Keep browser open between recordings | `/workbench` | — | ✅ | ✅ | ✅ | — | `workbench-keep-browser-open.jpg` |
| `workbench-fix-broken-step` — Workbench — Fixing a broken step | `/workbench` | — | ✅ | ✅ | ✅ | — | `workbench-fix-broken-step.jpg` |
| `home-new-project-clone-repo` — Projects — New project: Clone from repo | `/projects` | — | ✅ | — | — | — | `home-new-project-api-language.jpg` |
| `workbench-branches` — Workbench — Branches in the workstation | `/workbench` | — | ✅ | ✅ | ✅ | — | `workbench-branches.jpg` |
| `home-new-project-api-language` — Projects — New project: API language picker | `/projects` | — | ✅ | — | — | — | `home-new-project-api-language.jpg` |
| `home-new-project-jmx` — Projects — New project: JMX Builder tab | `/projects` | — | ✅ | — | — | — | `home-new-project-jmx.jpg` |
| `home-demo-project` — Projects — Try the demo project | `/projects` | — | ✅ | ✅ | — | — | `home-demo-project.jpg` |
| `onboarding-tour` — Projects — First-run tour | `/projects` | — | ✅ | ✅ | ✅ | — | `onboarding-tour.jpg` |
| `admin` — Admin — Overview | `/admin` | — | ✅ | ✅ | — | — | `admin.jpg` |
| `admin-manage-projects` — Manage Projects | `/admin` | `manage-projects` | ✅ | ✅ | — | — | `admin-manage-projects.jpg` |
| `admin-users` — Users | `/admin` | `users` | ✅ | ✅ | — | — | `admin-users.jpg` |
| `admin-team` — Managing your team | `/admin` | `team` | ✅ | ✅ | — | — | `admin-team.jpg` |
| `admin-git-repos` — Project Git Repos | `/admin` | `git-repos` | ✅ | — | — | — | `admin-git-repos.jpg` |
| `admin-repos-pat` — Repos PAT | `/admin` | `repos-pat` | ✅ | — | — | — | `admin-git-repos.jpg` |
| `admin-my-fork` — My fork (personal push target) | `/admin` | `git-repos` | ✅ | — | — | — | `admin-my-fork.jpg` |
| `admin-approval` — Code changes (approvals) | `/admin` | `approval` | ✅ | ✅ | — | — | `admin-approval.jpg` |
| `admin-lifecycle-requests` — Pending deletions | `/admin` | `lifecycle-requests` | ✅ | — | — | — | `admin-lifecycle-requests.jpg` |
| `admin-fork-requests` — Fork requests | `/admin` | `fork-requests` | ✅ | ✅ | — | — | `admin-fork-requests.jpg` |
| `admin-project-assignments` — Project assignments | `/admin` | `project-assignments` | ✅ | — | — | — | `admin-project-assignments.jpg` |
| `settings-architectures` — Architectures | `/admin` | `architectures` | ✅ | — | — | — | `settings-architectures.jpg` |
| `settings-recording` — Recording defaults | `/admin` | `recording` | ✅ | — | — | — | `settings-recording.jpg` |
| `settings-validation` — Validation retention | `/admin` | `validation` | ✅ | — | — | — | `settings-validation.jpg` |
| `settings-appearance` — Appearance | `/settings` | `appearance` | ✅ | ✅ | ✅ | — | `settings-appearance.jpg` |
| `settings-mocks` — Network mocks | `/settings` | `mocks` | ✅ | ✅ | — | — | `settings-mocks.jpg` |
| `tools` — Tools — Overview | `/tools` | — | ✅ | ✅ | — | — | `tools.jpg` |
| `tools-ai-agent` — AI Agent | `/tools/ai-agent` | — | ✅ | — | — | — | `tools-ai-agent.jpg` |
| `tools-ai-assists` — AI assists | `/tools/ai-agent` | — | ✅ | ✅ | ✅ | — | `tools-ai-assists.jpg` |
| `workbench-ai-run` — Workbench — AI run status | `/workbench/ai-runs/:projectName/:runId` | — | ✅ | ✅ | — | — | `workbench-ai-run.jpg` |
| `tools-validation-traces` — Validation traces | `/tools/validation-traces` | — | ✅ | — | — | — | `tools-validation-traces.jpg` |
| `tools-internal-tests` — Internal tests runner | `/tools/internal-tests` | — | ✅ | — | — | — | `tools-internal-tests.jpg` |
| `tools-test-runs` — Test runs history | `/tools/test-runs` | — | ✅ | ✅ | — | — | `tools-test-runs.jpg` |
| `settings-activity` — Activity log | `/tools/activity` | — | ✅ | ✅ | — | — | `settings-activity.jpg` |
| `settings-maintenance` — Maintenance | `/tools/maintenance` | — | ✅ | — | — | — | `settings-maintenance.jpg` |
| `my-approvals` — My submissions | `/my-approvals` | — | — | — | ✅ | — | `my-approvals.jpg` |
| `profile` — Profile (User info + Password) | `/profile` | — | ✅ | ✅ | ✅ | — | `profile.jpg` |
| `about` — About this app | `/about` | — | ✅ | ✅ | ✅ | — | `about.jpg` |

## Permissions notes (rendered on the Documentation page)

- **Landing page (signed out)** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Home — post-login landing** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Projects** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Workbench — Recording** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Workbench — Generate Pipeline File** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Workbench — Edit recorded steps** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Workbench — UI assertion catalog** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Workbench — Run all tests** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Workbench — API checks & route mocks** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Workbench — API solutions (multi-language)** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Workbench — Build Test (Python)** — Visible to Memento Admin and Admin.
- **Workbench — Build Test (Node.js)** — Visible to Memento Admin and Admin.
- **Workbench — Build Test (Java)** — Visible to Memento Admin and Admin.
- **Workbench — Accessibility scans** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Workbench — Visual baselines** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Workbench — Open Browser (hand-prep before recording)** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Workbench — Keep browser open between recordings** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Workbench — Fixing a broken step** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Projects — New project: Clone from repo** — Visible to Memento Admin and Admin.
- **Workbench — Branches in the workstation** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Projects — New project: API language picker** — Visible to Memento Admin and Admin.
- **Projects — New project: JMX Builder tab** — Visible to Memento Admin and Admin.
- **Projects — Try the demo project** — Visible to Memento Admin, Admin and Limited Admin.
- **Projects — First-run tour** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Admin — Overview** — Visible to Memento Admin, Admin and Limited Admin.
- **Manage Projects** — Visible to Memento Admin, Admin and Limited Admin.
- **Users** — Visible to Memento Admin, Admin and Limited Admin.
- **Managing your team** — Visible to Memento Admin, Admin and Limited Admin.
- **Project Git Repos** — Visible to Memento Admin and Admin.
- **Repos PAT** — Visible to Memento Admin and Admin.
- **My fork (personal push target)** — Visible to Memento Admin and Admin.
- **Code changes (approvals)** — Visible to Memento Admin, Admin and Limited Admin.
- **Pending deletions** — Visible to Memento Admin and Admin.
- **Fork requests** — Visible to Memento Admin, Admin and Limited Admin.
- **Project assignments** — Visible to Memento Admin and Admin.
- **Architectures** — Visible to Memento Admin and Admin.
- **Recording defaults** — Visible to Memento Admin and Admin.
- **Validation retention** — Visible to Memento Admin and Admin.
- **Appearance** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Network mocks** — Visible to Memento Admin, Admin and Limited Admin.
- **Tools — Overview** — Visible to Memento Admin, Admin and Limited Admin.
- **AI Agent** — Visible to Memento Admin and Admin.
- **AI assists** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **Workbench — AI run status** — Visible to Memento Admin, Admin and Limited Admin.
- **Validation traces** — Visible to Memento Admin and Admin.
- **Internal tests runner** — Visible to Memento Admin and Admin.
- **Test runs history** — Visible to Memento Admin, Admin and Limited Admin.
- **Activity log** — Visible to Memento Admin, Admin and Limited Admin.
- **Maintenance** — Visible to Memento Admin and Admin.
- **My submissions** — Visible to User only.
- **Profile (User info + Password)** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).
- **About this app** — Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).

## Roles

- `admin` — full access. Strict admin role checked by `useIsAdmin`.
- `limited_admin` — scoped admin for assigned projects. Checked by `useIsLimitedAdmin`; covered by `useIsAnyAdmin` for shared admin UIs.
- `limited` — regular user (labeled 'User' in the UI). The fall-through role.
- `guest` — throwaway trial identity from "Continue as guest" on the login page. One project, six hours, no AI features and no setup surfaces. Checked by `useIsGuest`; enforced server-side by the allow-list in `artifacts/api-server/src/shared/middlewares/guestAllowlist.ts`. Guests reuse the `limited` screenshots (the harness cannot sign in as a guest).

