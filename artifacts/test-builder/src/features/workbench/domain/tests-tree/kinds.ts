/**
 * Kind metadata shared by every tests-tree renderer.
 *
 * Pure data — no React, no DOM. Kept in the domain layer so the
 * presentation layer can import without dragging UI deps into rules.
 */
import type { TestKind } from "@workspace/api-client-react";

export const ALL_KINDS: TestKind[] = ["e2e", "unit", "api"];

export const KIND_LABEL: Record<TestKind, string> = {
  e2e: "E2E",
  unit: "Unit",
  api: "API",
};

export const KIND_BADGE_CLASS: Record<TestKind, string> = {
  e2e: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  unit: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  api: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};
