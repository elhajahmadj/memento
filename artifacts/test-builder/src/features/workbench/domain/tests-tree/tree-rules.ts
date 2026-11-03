/**
 * Pure rules for the discovered tests tree.
 *
 * No React, no DOM, no fetch — just deterministic transforms over the
 * `DiscoveredTest*` shapes coming back from the discovery endpoint.
 * The presentation layer imports these to render the tree; tests
 * exercise them directly without a render pass.
 */
import type {
  DiscoveredTestFile,
  DiscoveredTestFolder,
  DiscoveredTestMethod,
  DiscoveredTestNode,
  TestKind,
  TestTotals,
} from "@workspace/api-client-react";

export type CheckedState = boolean | "indeterminate";

/** Human-readable summary of a totals bucket ("2 E2E · 1 Unit"). */
export function formatTotals(totals: TestTotals): string {
  const parts: string[] = [];
  if (totals.e2e > 0) parts.push(`${totals.e2e} E2E`);
  if (totals.unit > 0) parts.push(`${totals.unit} Unit`);
  if (totals.api > 0) parts.push(`${totals.api} API`);
  return parts.length > 0 ? parts.join(" · ") : `${totals.all} tests`;
}

/** Walk a node and collect every method id underneath it. */
export function collectMethodIds(
  node: DiscoveredTestNode | DiscoveredTestMethod,
): string[] {
  if (node.type === "method") return [node.id];
  if (node.type === "file") return node.methods.map((m) => m.id);
  const out: string[] = [];
  for (const child of node.children) out.push(...collectMethodIds(child));
  return out;
}

export function totalsFromMethods(methods: DiscoveredTestMethod[]): TestTotals {
  let e2e = 0;
  let unit = 0;
  let api = 0;
  for (const m of methods) {
    if (m.kind === "e2e") e2e++;
    else if (m.kind === "unit") unit++;
    else if (m.kind === "api") api++;
  }
  return { e2e, unit, api, all: e2e + unit + api };
}

export function sumTotals(list: TestTotals[]): TestTotals {
  return list.reduce<TestTotals>(
    (acc, t) => ({
      e2e: acc.e2e + t.e2e,
      unit: acc.unit + t.unit,
      api: acc.api + t.api,
      all: acc.all + t.all,
    }),
    { e2e: 0, unit: 0, api: 0, all: 0 },
  );
}

/**
 * Prune a discovered file to the methods that match the active kind set
 * and the search query. A node "matches by name" when an ancestor's name
 * already contains the query, in which case all of its descendants
 * (subject to the kind filter) are kept.
 */
export function filterFile(
  file: DiscoveredTestFile,
  query: string,
  kinds: ReadonlySet<TestKind>,
  ancestorNameMatches: boolean,
): DiscoveredTestFile | null {
  const fileMatches =
    ancestorNameMatches || !query || file.name.toLowerCase().includes(query);
  const methods = file.methods.filter(
    (m) =>
      kinds.has(m.kind) &&
      (fileMatches || m.name.toLowerCase().includes(query)),
  );
  if (methods.length === 0) return null;
  return { ...file, methods, totals: totalsFromMethods(methods) };
}

export function filterFolder(
  folder: DiscoveredTestFolder,
  query: string,
  kinds: ReadonlySet<TestKind>,
  ancestorNameMatches: boolean,
): DiscoveredTestFolder | null {
  const folderMatches =
    ancestorNameMatches || !query || folder.name.toLowerCase().includes(query);
  const children: DiscoveredTestNode[] = [];
  for (const child of folder.children) {
    const next =
      child.type === "folder"
        ? filterFolder(child, query, kinds, folderMatches)
        : filterFile(child, query, kinds, folderMatches);
    if (next) children.push(next);
  }
  if (children.length === 0) return null;
  return {
    ...folder,
    children,
    totals: sumTotals(children.map((c) => c.totals)),
  };
}

/** Tri-state checkbox value for a subtree given the selected set. */
export function tristateFor(
  idsInSubtree: string[],
  selected: ReadonlySet<string>,
): CheckedState {
  if (idsInSubtree.length === 0) return false;
  let hits = 0;
  for (const id of idsInSubtree) if (selected.has(id)) hits++;
  if (hits === 0) return false;
  if (hits === idsInSubtree.length) return true;
  return "indeterminate";
}
