import type { AdminUser } from "@workspace/api-client-react";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function fullName(user: AdminUser): string {
  const fn = user.firstName?.trim() ?? "";
  const ln = user.lastName?.trim() ?? "";
  const joined = `${fn} ${ln}`.trim();
  return joined.length > 0 ? joined : "—";
}

export function formatLastLogin(value: string | null): string {
  if (!value) return "Never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Never";
  return d.toLocaleString();
}
