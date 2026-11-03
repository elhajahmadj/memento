import type { GitProvider } from "./gitProvider";

/**
 * Port for a git hosting provider. Each implementation owns:
 *  - Validating that a user-supplied repo URL is plausibly one of
 *    its repositories (and stripping any embedded credentials).
 *  - Injecting a Personal Access Token into a clone URL using the
 *    provider-specific username convention.
 */
export interface GitProviderAdapter {
  readonly provider: GitProvider;
  /** Throws if the URL is not a valid repo URL for this provider. */
  validateRepoUrl(raw: string): string;
  /** Inject a PAT into the clone URL; returns the credential-bearing URL. */
  injectPatIntoUrl(repoUrl: string, pat: string): string;
}
