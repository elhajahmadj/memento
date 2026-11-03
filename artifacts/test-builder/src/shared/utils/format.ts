export function formatDateTime(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return "";
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return typeof value === "string" ? value : "";
    return d.toLocaleString();
  } catch {
    return typeof value === "string" ? value : "";
  }
}

export function formatRelative(
  value: string | Date,
  now: number = Date.now(),
): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const ms = now - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return d.toLocaleString();
}
