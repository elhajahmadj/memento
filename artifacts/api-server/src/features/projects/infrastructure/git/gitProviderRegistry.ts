import { azureReposAdapter, validateAzureRepoUrl } from "./azureReposAdapter";
import { githubAdapter, validateGitHubRepoUrl } from "./githubAdapter";
import { isAllowedTestModeRepoUrl } from "./devModeRepoUrl";
import type { GitProvider } from "./gitProvider";
import type { GitProviderAdapter } from "./gitProviderAdapter";

export { validateAzureRepoUrl, validateGitHubRepoUrl };

const ADAPTERS: Record<GitProvider, GitProviderAdapter> = {
  azure_repos: azureReposAdapter,
  github: githubAdapter,
};

export function getProviderAdapter(provider: GitProvider): GitProviderAdapter {
  return ADAPTERS[provider];
}

/**
 * Provider-aware repo-URL validation. Dev/local environments may
 * pass `file://` / loopback `http://` URLs through verbatim — see
 * `isAllowedTestModeRepoUrl`.
 */
export function validateRepoUrl(provider: GitProvider, raw: string): string {
  if (isAllowedTestModeRepoUrl(raw)) return raw;
  return getProviderAdapter(provider).validateRepoUrl(raw);
}

export function injectPatIntoUrl(
  provider: GitProvider,
  repoUrl: string,
  pat: string,
): string {
  return getProviderAdapter(provider).injectPatIntoUrl(repoUrl, pat);
}
