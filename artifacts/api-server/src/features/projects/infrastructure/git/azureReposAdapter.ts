import type { GitProviderAdapter } from "./gitProviderAdapter";

/** Validate that the URL is a plausible Azure Repos HTTPS URL. */
export function validateAzureRepoUrl(raw: string): string {
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
  const isAzure =
    host === "dev.azure.com" ||
    host.endsWith(".visualstudio.com") ||
    host === "ssh.dev.azure.com";
  if (!isAzure) {
    throw new Error(
      "Repository URL must be an Azure Repos URL (dev.azure.com or *.visualstudio.com)",
    );
  }
  // Strip any embedded credentials so we never persist a PAT inside the URL.
  u.username = "";
  u.password = "";
  return u.toString();
}

export const azureReposAdapter: GitProviderAdapter = {
  provider: "azure_repos",
  validateRepoUrl: validateAzureRepoUrl,
  injectPatIntoUrl(repoUrl, pat) {
    const u = new URL(repoUrl);
    if (u.protocol === "file:") return repoUrl;
    // Azure Repos accepts any non-empty username with the PAT as the password.
    u.username = "memento";
    u.password = pat;
    return u.toString();
  },
};
