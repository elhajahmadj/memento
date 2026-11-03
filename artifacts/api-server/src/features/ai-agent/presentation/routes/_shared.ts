import { resolveScopePolicy } from "@/features/auth/infrastructure/orgScope";

export function paramString(v: unknown): string {
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

export async function getActiveOrgId(
  req: Parameters<typeof resolveScopePolicy>[0],
): Promise<string | null> {
  const policy = await resolveScopePolicy(req);
  if (policy.kind === "org") return policy.orgId;
  return null;
}
