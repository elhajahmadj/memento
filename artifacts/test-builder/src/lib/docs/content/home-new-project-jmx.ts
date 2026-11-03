import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "home-new-project-jmx",
    heading: "Home — New project: JMX Builder tab",
    intro:
      "The New Project dialog has three tabs: Scaffold a new project, Clone from repo, and JMX Builder. The JMX Builder tab creates a JMeter load-test project (language `jmx`) instead of a Playwright/UI or API test solution. JMX projects do not generate source code — they record raw HTTP traffic through the embedded browser and emit a JMeter `.jmx` Test Plan you can replay with `jmeter -n -t plan.jmx ...`. Recording, emission, and the file explorer live in the workbench; this page documents the dialog tab and the resulting on-disk shape.",
    walkthrough: [
      "On the admin Home, click New project to open the dialog.",
      "Open the JMX Builder tab (third tab, alongside Scaffold and Clone from repo).",
      "Fill in Project name (required), Target URL (required, must be `http://...` or `https://...`), and toggle Use JWT auth if the target authenticates with a bearer token. Toggle BFF (Backend-for-Frontend) auth if the target sits behind a BFF proxy that handles OAuth/CSRF/session cookies on the server — this flips the project into BFF-aware capture mode for the downstream recorder/IR/correlation features.",
      "Click Create. The api-server scaffolds a JMX project on disk, writes a `.testbuilder.json` with `language: \"jmx\"`, the chosen `targetUrl`, the `jwtAuth` flag, the `bff` flag, and an empty `jmxFiles: []` array, then redirects you to /workbench for the new project.",
      "The workbench opens with the embedded recorder browser already navigated to your Target URL in a preview state — no HTTP capture is armed yet and no \"recording started\" toast fires. The toolbar shows Start Recording (and a Close Browser option) instead of Stop Recording.",
      "Click Start Recording to name the `.jmx` file (pre-filled with `recording-1.jmx`) and arm capture on the already-open browser. The page does not re-navigate and no second browser is spawned. Interact with the site as normal — every top-level HTTP request is captured server-side.",
      "Click Stop Recording when you're done. The emitter writes `<project>/jmx/<name>.jmx`, appends the filename to `.testbuilder.json#jmxFiles`, and the Explorer's JMX files tab refreshes automatically so the new file appears without a manual reload. The workbench right panel hides its Test Suites section for JMX projects (there are no generated test classes to list); the Recorded Actions toolbar, Actions Feed, History, and Test Body Preview render normally.",
    ],
    fields: [
      {
        name: "Project name",
        description:
          "Required. Validated like the other tabs (no path separators, no collisions with an existing project). Becomes the workspace folder name.",
      },
      {
        name: "Target URL",
        description:
          "Required. Must parse as a `http://` or `https://` URL. Stored in `.testbuilder.json#targetUrl` and used as the JMeter `HTTP Request Defaults` host/port at emission time so absolute URLs in the capture become path-only samplers.",
      },
      {
        name: "Use JWT auth",
        description:
          "Optional checkbox, default off. When on, the emitter wires a JSON Extractor after the login request to pull a bearer token (default JSONPath `$.access_token` or `$.token`) into `${access_token}` and replays it as an `Authorization: Bearer ${access_token}` header on every subsequent sampler.",
      },
      {
        name: "BFF (Backend-for-Frontend) auth",
        description:
          "Optional checkbox, default off. When on, the project is marked as a BFF-style auth project — the flag is persisted as `bff: true` on the `.testbuilder.json` marker and is the foundation downstream features branch on to enable BFF-aware OAuth redirect-body capture, PKCE / state / code correlation, CSRF / double-submit correlation, and `storageState` persistence from JMX recordings. Setting it at creation time has no immediate runtime effect on its own — it just turns those follow-up capture/correlation features on for this project.",
      },
      {
        name: "Emitted JMeter element tree",
        description:
          "Each `.jmx` file is a single Test Plan with the structure: `Test Plan` → (`User Defined Variables` when present) → `Thread Group` → `HTTP Request Defaults` (host/port/scheme from Target URL) → `HTTP Cookie Manager` → `HTTP Header Manager` → (`CSV Data Set Config` when CSV mode is on) → `Login Sampler` → (`JSON Extractor` for `${access_token}` when Use JWT auth is on) → captured `HTTP Sampler`s (path-only). Every element has a matching `<hashTree>` and the emitter re-parses the output to verify pairing.",
      },
      {
        name: "Export mode — With credentials",
        description:
          "Username/password from the captured login appear literally in the login sampler body and User Defined Variables. The plan is tagged \"unsafe to share\" and the workbench shows a warning banner: \"This JMX contains credentials in plaintext XML. Use only for local testing.\" Use this mode for the developer's \"just run it\" loop, never check the file in.",
      },
      {
        name: "Export mode — Without credentials",
        description:
          "Credentials are replaced with JMeter variables resolved via `${__P(username,)}` / `${__P(password,)}` (or read from a CSV Data Set when `csvMode` is `perRequest` / `global`). The validator scans the serialized XML for literal credential strings and any captured `Authorization: Bearer ...` value; emission is blocked with a clear error if anything leaks. This is the mode for checking the plan into source control and running it in CI.",
      },
      {
        name: "Runtime injection examples",
        description:
          "DEV (interactive, props on the CLI): `jmeter -n -t plan.jmx -Jusername=alice -Jpassword=s3cret -l results.jtl`. QA (CSV-driven, multi-user): write `users.csv` with `username,password` rows and run `jmeter -n -t plan.jmx -l results.jtl` (the CSV Data Set Config picks `users.csv` up automatically). PROD (env-var overrides via a wrapper): `JMX_USER=$PROD_USER JMX_PASS=$PROD_PASS jmeter -n -t plan.jmx -Jusername=$JMX_USER -Jpassword=$JMX_PASS -Jhost=api.prod.example.com -l results.jtl`. The `Target URL` host/port is also overridable via `-Jhost=...` / `-Jport=...` because it's wired through `HTTP Request Defaults`.",
      },
      {
        name: "On-disk layout",
        description:
          "Scaffolded under `workspace/<project>/`. The marker file plus `.testbuilder.json` (`language: \"jmx\"`, `targetUrl`, `jwtAuth`, `jmxFiles: []`) identify the project on boot. Recorded `.jmx` files land under `<project>/jmx/<name>.jmx` and their filenames are appended to `.testbuilder.json#jmxFiles` so the workbench file explorer can list and download them.",
      },
      {
        name: "Where it is",
        description:
          "`tab-jmx-builder` on `new-project-dialog.tsx`. The submit button reuses the shared `Button` component (label: Create) so the look matches the Scaffold and Clone from repo tabs. On success the dialog routes through the same `useCreateProject` mutation and redirects to `/workbench` for the new project.",
      },
      {
        name: "Permissions",
        description:
          "The New project button is gated by `useIsAdmin()`, so the JMX Builder tab is reachable by Admin and Memento Admin only. Limited Admin and User see the existing \"Request new project\" path instead.",
      },
    ],
  },
];
