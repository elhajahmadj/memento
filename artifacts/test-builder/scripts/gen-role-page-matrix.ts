#!/usr/bin/env -S tsx
/**
 * Regenerate `docs/role-page-matrix.md` (at the repo root) from the
 * typed matrix module `src/lib/docs/matrix.ts`. The markdown is checked
 * in so reviewers can see the role × page table without running the
 * app, but the TypeScript module is the single source of truth.
 *
 * Usage:
 *   pnpm --filter @workspace/test-builder run docs:matrix
 *
 * Lives under `scripts/` (outside `src/`) so the test-builder
 * `tsc --noEmit` typecheck doesn't try to compile it as application
 * code; it's a build-time-only tool.
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DOCS_MATRIX,
  permissionsNote,
  screenshotKey,
  type DocsMatrixEntry,
} from "../src/lib/docs/matrix";

// `memento_admin` is intentionally absent: it is a god-mode superset of
// `admin`, so its column would be identical and add noise. `guest` IS
// listed because its visibility is a genuinely distinct (much smaller)
// subset that reviewers need to be able to check at a glance.
const ROLES = ["admin", "limited_admin", "limited", "guest"] as const;
type Role = (typeof ROLES)[number];

function tick(entry: DocsMatrixEntry, role: Role): string {
  return entry.allowedRoles.includes(role) ? "✅" : "—";
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function build(): string {
  const lines: string[] = [];
  lines.push("# Role × Page documentation matrix");
  lines.push("");
  lines.push(
    "**Auto-generated** by `artifacts/test-builder/scripts/gen-role-page-matrix.ts` from `artifacts/test-builder/src/lib/docs/matrix.ts`. Do not edit by hand — run `pnpm --filter @workspace/test-builder run docs:matrix` after changing the matrix module.",
  );
  lines.push("");
  lines.push(
    "This table is the single source of truth for: which sections show up in the `/documentation` sidebar per role, the auto-generated 'Permissions' note rendered on each section, and the role/route coverage check enforced by the Playwright screenshot harness in `artifacts/test-builder/e2e-docs/`.",
  );
  lines.push("");
  lines.push(
    "| Section | Route | Settings sub-section | Admin | Limited Admin | User | Guest | Screenshot key |",
  );
  lines.push("|---|---|---|:---:|:---:|:---:|:---:|---|");
  for (const entry of DOCS_MATRIX) {
    const sub = entry.settingsSectionTestId ?? "—";
    lines.push(
      `| \`${entry.sectionId}\` — ${escapePipes(entry.label)} | \`${entry.route}\` | ${sub === "—" ? "—" : `\`${sub}\``} | ${tick(entry, "admin")} | ${tick(entry, "limited_admin")} | ${tick(entry, "limited")} | ${tick(entry, "guest")} | \`${screenshotKey(entry)}.jpg\` |`,
    );
  }
  lines.push("");
  lines.push("## Permissions notes (rendered on the Documentation page)");
  lines.push("");
  for (const entry of DOCS_MATRIX) {
    lines.push(`- **${entry.label}** — ${permissionsNote(entry)}`);
  }
  lines.push("");
  lines.push("## Roles");
  lines.push("");
  lines.push(
    "- `admin` — full access. Strict admin role checked by `useIsAdmin`.",
  );
  lines.push(
    "- `limited_admin` — scoped admin for assigned projects. Checked by `useIsLimitedAdmin`; covered by `useIsAnyAdmin` for shared admin UIs.",
  );
  lines.push(
    "- `limited` — regular user (labeled 'User' in the UI). The fall-through role.",
  );
  lines.push(
    "- `guest` — throwaway trial identity from \"Continue as guest\" on the login page. One project, six hours, no AI features and no setup surfaces. Checked by `useIsGuest`; enforced server-side by the allow-list in `artifacts/api-server/src/shared/middlewares/guestAllowlist.ts`. Guests reuse the `limited` screenshots (the harness cannot sign in as a guest).",
  );
  lines.push("");
  return lines.join("\n");
}

function parseOutArg(argv: string[]): string | null {
  const idx = argv.indexOf("--out");
  if (idx >= 0 && idx + 1 < argv.length) {
    return argv[idx + 1] ?? null;
  }
  const eq = argv.find((a) => a.startsWith("--out="));
  if (eq) return eq.slice("--out=".length);
  return null;
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  // here = artifacts/test-builder/scripts → repo root is three up.
  const repoRoot = resolve(here, "..", "..", "..");
  const override = parseOutArg(process.argv.slice(2));
  const outPath = override
    ? resolve(process.cwd(), override)
    : resolve(repoRoot, "docs", "role-page-matrix.md");
  const content = build();
  writeFileSync(outPath, content + "\n", "utf8");
  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${outPath} (${ROLES.length} roles, ${DOCS_MATRIX.length} sections).`,
  );
}

main();
