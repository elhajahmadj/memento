import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-api-checks",
    heading: "Workbench — API checks & route mocks",
    intro:
      "Backend coverage without leaving the recorder. The Workbench's Add API check button appends an `apiAssertion` step that issues an HTTP request via Playwright's `request.fetch()` and asserts the response status (and optionally the JSON body) during replay. The matching route-mock manager — under Settings → Network mocks — installs `page.route()` interceptions before navigation so the recorder and replay both run against deterministic canned responses instead of the live backend. The two work together: mock the upstream API while you record / replay, then assert the request itself was made with the expected status.",
    walkthrough: [
      "From an active recording or saved suite, click Add API check on the Workbench toolbar to open the dialog.",
      "Pick the HTTP method (GET / POST / PUT / PATCH / DELETE), enter the absolute URL, and the expected status code (100–599).",
      "Optionally paste a JSON request body and / or an expected JSON response substring; both are validated client-side before submit.",
      "Click Add. The step is appended to the recording as an `apiAssertion` action and the codegen emits the per-language `request.fetch(...)` call alongside an `expect(response.status()).toBe(...)` assertion.",
      "To mock the API the page calls instead of (or in addition to) asserting on it, open Settings → Network mocks for this project and add a rule with the matching URL pattern, status code, and response body. Mocks marked Enabled are installed automatically by both the recorder and the replay engine via `page.route()`.",
      "Validate the recording — the API check shows up as its own step in the Validation panel with pass / fail status and the actual response status on failure.",
    ],
    fields: [
      { name: "Add API check button", description: "Opens the Add-API-check dialog. Available on every recording row, including unsaved in-memory sessions." },
      { name: "Method / URL / Expected status", description: "Required fields: HTTP verb, absolute URL, and the response status the assertion should match. The status is range-validated (100–599) before Add is enabled." },
      { name: "Request body (JSON)", description: "Optional. When present must be valid JSON; the codegen serialises it as the `data:` field on the per-language `request.fetch(...)` call." },
      { name: "Expected response JSON", description: "Optional substring of the response body the codegen will assert with `expect(text).toContain(...)`. Useful for spot-checking a JSON payload without a full schema." },
      { name: "Settings → Network mocks", description: "Project-scoped mock rules (per user). Each enabled rule installs a Playwright `page.route()` interception during recording and replay. Documented as its own section under Settings → Network mocks." },
      { name: "Per-language codegen", description: "Emits `await page.request.<method>(url, { data })` (Node.js / TS), `self.page.request.<method>(...)` (Python), `Page.APIRequestContext.<method>Async(...)` (C#), and `page.request().<method>(...)` (Java) plus the matching status-equality assertion." },
    ],
  },
];
