import type { AuthUserRole } from "@workspace/api-client-react";

export interface DocFeature {
  title: string;
  body: string[];
}

export interface DocSection {
  id: string;
  title: string;
  summary: string;
  features: DocFeature[];
}

export interface RoleDoc {
  role: AuthUserRole;
  label: string;
  intro: string;
  sections: DocSection[];
}

export const APP_OVERVIEW = {
  title: "What this app does",
  paragraphs: [
    "Playwright Test Builder is a workbench for turning real browser interactions into clean, page-object-style Playwright tests. You pick a target language — C# (.NET / NUnit), Python (pytest), Node.js (@playwright/test), or Java (JUnit 5 + Playwright on a Maven multi-module layout) — scaffold a solution from an architecture template, point the recorder at a target URL, and the actions you take in the browser are written into the test method (or shared setup hook) you chose. The generated solution is a real, runnable project on disk: `dotnet test` for C#, `pytest` for Python, `npx playwright test` for Node.js, and `mvn test` (JDK 17 + Maven 3.9+) for Java.",
    "Work is organized around projects. Admins scaffold and own the canonical projects in the workspace folder. Limited admins are scoped to a subset of those projects and can review/approve changes for them. Regular users work in personal forks of a project and submit their changes back for an SDET to review.",
  ],
};

/**
 * Per-role narrative docs live in `./role-docs` — that file is pure
 * data and grows with every new role/page, so it is kept separate to
 * stop this module (the public surface: types, overview, lookup) from
 * sprawling. Re-exported here so callers keep a single import site.
 */
export { ROLE_DOCS, docsForRole } from "./role-docs";
