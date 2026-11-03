export type GitProvider = "azure_repos" | "github";

export const SUPPORTED_PROVIDERS: readonly GitProvider[] = [
  "azure_repos",
  "github",
];

export const PROJECT_MARKER_FILE = ".testbuilder.json";

export function isGitProvider(v: unknown): v is GitProvider {
  return (
    typeof v === "string" &&
    (SUPPORTED_PROVIDERS as readonly string[]).includes(v)
  );
}

export function normalizeProvider(v: string | null | undefined): GitProvider {
  return isGitProvider(v) ? v : "azure_repos";
}
