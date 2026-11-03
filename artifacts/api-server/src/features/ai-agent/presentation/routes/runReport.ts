import path from "node:path";
import fs from "node:fs/promises";
import type { aiRunsTable } from "@workspace/db";
import { recorderConfig } from "@/features/projects/infrastructure/config";

// Normalize the stored report (runner shape) into the OpenAPI contract
// the client consumes: { steps, files, summary }. The runner stores
// `materializedFiles` separately as a string[] of project-relative POSIX
// paths, so stat them here to compute byte sizes for the UI. Missing
// files are reported as 0 bytes rather than failing the whole request.
//
// The runner persists the rich `AiRunStep` shape (input/method/result/...)
// but the OpenAPI contract for the run-status page exposes a flattened
// `{ message, status: passed|failed|skipped }` per step. Normalize here
// so the contract holds and the schema validation in
// `assertResponseShape` does not 500 on every poll (the symptom: the
// run-status page spins forever because every poll fails before the
// spinner can clear). Legacy stored rows that still use the old
// `{ message, ok }` shape are mapped to passed/failed below.
export async function buildRunReport(
  row: typeof aiRunsTable.$inferSelect,
): Promise<{
  steps: Array<{ message: string; status: "passed" | "failed" | "skipped" }>;
  files: Array<{ path: string; bytes: number }>;
  summary: string;
  setupContextText: string | null;
} | null> {
  const stored = (row.report ?? null) as
    | {
        steps?: Array<
          | { message: string; ok: boolean }
          | {
              input?: string;
              result?: "passed" | "failed" | "skipped";
              errorMessage?: string | null;
            }
        >;
        summary?: string;
        setupContextText?: unknown;
      }
    | null;
  if (!stored) return null;
  const projectRoot = path.join(recorderConfig.workspaceDir, row.projectName);
  const matFiles = (row.materializedFiles ?? []) as string[];
  const files = await Promise.all(
    matFiles.map(async (rel: string) => {
      try {
        const st = await fs.stat(path.join(projectRoot, rel));
        return { path: rel, bytes: st.size };
      } catch {
        return { path: rel, bytes: 0 };
      }
    }),
  );
  return {
    steps: (stored.steps ?? []).map(normalizeStep),
    files,
    summary:
      stored.summary ??
      (row.status === "succeeded"
        ? `Generated ${files.length} file(s).`
        : row.status === "failed"
          ? row.errorMessage ?? "Run failed."
          : "Run in progress."),
    setupContextText:
      typeof stored.setupContextText === "string"
        ? stored.setupContextText
        : null,
  };
}

function normalizeStep(
  raw: unknown,
): { message: string; status: "passed" | "failed" | "skipped" } {
  const s = (raw ?? {}) as {
    message?: string;
    ok?: boolean;
    input?: string;
    result?: "passed" | "failed" | "skipped";
    errorMessage?: string | null;
  };
  // Newer runner shape: rich step with `result`. Surface the
  // tri-state directly so the UI can render skipped as a neutral
  // indicator instead of collapsing it into a red X.
  if (
    s.result === "passed" ||
    s.result === "failed" ||
    s.result === "skipped"
  ) {
    const base = s.input ?? "(step)";
    const message = s.errorMessage ? `${base}: ${s.errorMessage}` : base;
    return { message, status: s.result };
  }
  // Legacy stored shape: `{ message, ok }`. Map ok → passed/failed
  // (skipped is a brand-new state, so legacy rows can't have it).
  if (typeof s.message === "string" && typeof s.ok === "boolean") {
    return { message: s.message, status: s.ok ? "passed" : "failed" };
  }
  // Defensive fallback for any other unknown shape — do not crash
  // the run-status page; treat as skipped so it renders neutrally.
  return {
    message: typeof s.message === "string" ? s.message : "(step)",
    status: "skipped",
  };
}
