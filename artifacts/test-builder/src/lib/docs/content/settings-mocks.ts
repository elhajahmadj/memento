import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "settings-mocks",
    heading: "Settings — Network mocks",
    intro:
      "Per-project, per-user network mock rules. Each enabled rule installs a Playwright `page.route()` interception before navigation, so both the recorder and the in-app Validate engine intercept matching requests and reply with a canned response. Mocks are scoped to a single user inside a single project — two users editing the same project keep their own mock sets, so admin scratch rules don't leak into other users' replays.",
    walkthrough: [
      "Open a project so the section has a project name to scope mocks to (the section shows a friendly empty-state when no project is loaded).",
      "Open Settings → Network mocks.",
      "Click Add mock to open the editor dialog. Give the rule a name (free-form), pick the HTTP method, type the URL pattern (Playwright glob syntax — e.g. `**/api/users/me`), set the response status (100–599), and optionally paste a JSON response body.",
      "Click Save. The rule appears in the list with an enabled toggle, an Edit button, and a Delete (trash) button.",
      "Use the per-row toggle to enable / disable a rule without losing its definition. Disabled rules stay in the table so you can switch them back on later.",
      "Click Edit on any row to open the same dialog pre-filled. Click the trash icon to permanently delete the rule.",
    ],
    fields: [
      { name: "Add mock", description: "Opens the editor dialog for a brand-new rule. Form validation enforces a non-empty name + URL pattern, a 100–599 status code, and (when present) valid JSON in the response body." },
      { name: "Name", description: "Human-readable label for the rule. Unique per (user, project)." },
      { name: "Method", description: "HTTP verb the interception should match (GET / POST / PUT / PATCH / DELETE)." },
      { name: "URL pattern", description: "Playwright glob pattern matched against the outgoing request URL. Use `**` to match any path segment, `?` for a single character, `*` for any segment without slashes." },
      { name: "Status", description: "HTTP status code the canned response should report. Range 100–599." },
      { name: "Response body (JSON)", description: "Optional JSON payload returned to the page. Empty body responds with `{}` (or whatever Playwright defaults to for that status code)." },
      { name: "Enabled toggle", description: "Per-row switch. Disabled rules remain in the table but are not installed by the recorder / replay." },
      { name: "Edit / Delete", description: "Edit re-opens the dialog with the current values pre-filled; Delete permanently removes the row (no undo)." },
      { name: "Backing storage", description: "`route_mocks` Drizzle table — `(userId, projectName, name)` is unique. Endpoints: `GET /api/route-mocks?projectName=`, `POST /api/route-mocks`, `PATCH /api/route-mocks/:id`, `DELETE /api/route-mocks/:id`." },
    ],
  },
];
