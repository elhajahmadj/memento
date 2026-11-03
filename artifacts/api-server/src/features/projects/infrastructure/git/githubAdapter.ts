import type { GitProviderAdapter } from "./gitProviderAdapter";

/** Validate that the URL is a plausible GitHub HTTPS URL. */
export function validateGitHubRepoUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Repository URL must be a valid URL");
  }
  if (u.protocol !== "https:") {
    throw new Error("Repository URL must use HTTPS");
  }
  const host = u.hostname.toLowerCase();
  const isGitHub = host === "github.com" || host === "www.github.com";
  if (!isGitHub) {
    throw new Error("Repository URL must be a GitHub URL (github.com)");
  }
  // Normalize host (drop www.) and strip embedded credentials.
  u.hostname = "github.com";
  u.username = "";
  u.password = "";
  return u.toString();
}

export const githubAdapter: GitProviderAdapter = {
  provider: "github",
  validateRepoUrl: validateGitHubRepoUrl,
  injectPatIntoUrl(repoUrl, pat) {
    const u = new URL(repoUrl);
    if (u.protocol === "file:") return repoUrl;
    // GitHub recommends `x-access-token:<token>@github.com/...` for both
    // fine-grained and classic PATs.
    u.username = "x-access-token";
    u.password = pat;
    return u.toString();
  },
};
