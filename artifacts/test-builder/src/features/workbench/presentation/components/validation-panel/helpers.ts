import type { RecordedRecordingDto } from "@workspace/api-client-react";

export function wsUrlFor(runId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/validation/${encodeURIComponent(runId)}`;
}

export function describePlanStep(s: Record<string, unknown>): string {
  const t = (s.type as string) ?? "step";
  const v = s.value as string | undefined;
  const url = s.url as string | undefined;
  if (t === "navigate") return `navigate ${url ?? v ?? ""}`.trim();
  if (t === "fill") return `fill ${v ? `"${v}"` : ""}`.trim();
  if (t === "click") return "click";
  if (t === "select") return `select ${v ?? ""}`.trim();
  if (t === "check") return "check";
  return t;
}

export function recordingLabel(r: RecordedRecordingDto): string {
  const file = r.filePath.split("/").pop() ?? r.filePath;
  if (r.kind === "testMethod") return `${file} → [Test] ${r.methodName}`;
  if (r.kind === "beforeEach") return `${file} → BeforeEachAsync`;
  return `${file} → OneTimeSetUpAsync`;
}
