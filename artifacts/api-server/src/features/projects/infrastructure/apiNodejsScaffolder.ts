import fs from "node:fs/promises";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { ApiScaffoldResult } from "@/features/projects/infrastructure/apiCsharpScaffolder";
import { nodejsPackageName } from "@/features/projects/domain/naming";

/**
 * Folder layout for Node.js API solutions. Mirrors the C# split between a
 * helper "automation-api" library and a sibling "tests" project, but uses
 * a single npm package rooted at `package.json` and kebab-case file names
 * everywhere.
 */
export const NODEJS_API_HELPER_DIR = "src/automation-api";
export const NODEJS_API_TESTS_DIR = "tests";

function packageJson(solutionName: string): string {
  return `${JSON.stringify(
    {
      name: nodejsPackageName(solutionName),
      version: "0.0.0",
      private: true,
      type: "module",
      description: "API test solution scaffolded by memento (Node.js + Vitest + undici).",
      scripts: {
        test: "vitest run",
      },
      dependencies: {
        undici: "^7.4.0",
        zod: "^3.23.8",
      },
      devDependencies: {
        vitest: "^2.1.0",
        typescript: "^5.9.0",
      },
    },
    null,
    2,
  )}\n`;
}

function tsconfigJson(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ES2022",
        moduleResolution: "Bundler",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        types: ["node", "vitest/globals"],
      },
      include: ["src/**/*", "tests/**/*"],
    },
    null,
    2,
  )}\n`;
}

function appsettingsJson(): string {
  return `${JSON.stringify({ ApiTest: { Urls: {} } }, null, 2)}\n`;
}

export function apiEndpointsTs(): string {
  return `/**
 * Endpoint route constants for API tests. Build Test → AssistantBuilder
 * appends new entries (or nested section objects) here atomically. Paths
 * may use \`{0}\`, \`{1}\`, ... placeholders that the helper methods feed
 * through \`formatPath\` from the fixture.
 */
export const ApiEndpoints = {
} as const;
`;
}

function testCollections(): string {
  return `/**
 * Canonical Vitest test collection names. Generated test files import
 * the shared \`apiTestFixture\` from the API collection, so the constant
 * is mostly informational — kept here to mirror the C# scaffold.
 */
export const TestCollections = {
  Api: "API",
} as const;
`;
}

function apiTestOptions(): string {
  return `/**
 * Strongly-typed bindings for the per-environment URL block in
 * \`tests/appsettings.json\` under \`ApiTest.Urls.{urlName}\`. Each generated
 * helper names a URL and the fixture maps it to one of these.
 */
export interface ApiTestOptions {
  baseUrl: string;
}
`;
}

function retryHandler(): string {
  return `/**
 * Retries transient HTTP failures (5xx + 408 + 429) with exponential
 * backoff. Wraps any async fetch invocation.
 */
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

export async function withRetry(
  send: () => Promise<Response>,
  opts: RetryOptions = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 200;
  for (let attempt = 0; ; attempt++) {
    const response = await send();
    if (attempt >= maxRetries || !shouldRetry(response.status)) {
      return response;
    }
    const delay = baseDelayMs * Math.pow(2, attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function shouldRetry(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}
`;
}

function httpLoggingHandler(): string {
  return `/**
 * Mirrors every request/response line to \`console.log\` so Vitest's
 * per-test output captures it. Keeps payloads compact (status + method +
 * url + elapsed).
 */
export async function withLogging(
  method: string,
  url: string,
  send: () => Promise<Response>,
): Promise<Response> {
  const started = Date.now();
  // eslint-disable-next-line no-console
  console.log(\`[HTTP] -> \${method} \${url}\`);
  try {
    const response = await send();
    const elapsed = Date.now() - started;
    // eslint-disable-next-line no-console
    console.log(
      \`[HTTP] <- \${response.status} \${method} \${url} (\${elapsed}ms)\`,
    );
    return response;
  } catch (err) {
    const elapsed = Date.now() - started;
    // eslint-disable-next-line no-console
    console.log(
      \`[HTTP] !! \${method} \${url} threw \${(err as Error).name} after \${elapsed}ms\`,
    );
    throw err;
  }
}
`;
}

function configurationExtensions(): string {
  return `import type { AppSettings } from "../infrastructure/api-test-fixture";

/**
 * Mock token mint. Returns a deterministic placeholder so test runs don't
 * accidentally hit a real IDP from CI. Replace the body with your real
 * token acquisition (client credentials, password grant, SAML→OAuth
 * exchange, …) when wiring up against a live API.
 */
export function getAccessToken(settings: AppSettings, urlName: string): string {
  const entry = settings.ApiTest?.Urls?.[urlName];
  return entry?.AccessToken ?? "mock-access-token";
}
`;
}

function apiTestFixture(): string {
  return `import fs from "node:fs";
import path from "node:path";
import type { ApiTestOptions } from "./api-test-options";
import { withRetry } from "../handlers/retry-handler";
import { withLogging } from "../handlers/http-logging-handler";

export interface AppSettings {
  ApiTest?: {
    Urls?: Record<string, { BaseUrl: string; AccessToken?: string }>;
  };
}

/**
 * Substitute \`{0}\`, \`{1}\`, … placeholders in an endpoint template with the
 * supplied arguments. Mirrors C#'s \`string.Format\`.
 */
export function formatPath(template: string, ...args: unknown[]): string {
  return template.replace(/\\{(\\d+)\\}/g, (_, n: string) =>
    String(args[Number(n)]),
  );
}

/**
 * Shared API test fixture. Vitest constructs this once per run via the
 * \`api-test-collection\` module; the singleton resolves URL blocks under
 * \`ApiTest.Urls.{urlName}\` in \`tests/appsettings.json\`.
 */
export class ApiTestFixture {
  readonly settings: AppSettings;

  constructor(settingsPath?: string) {
    const resolved =
      settingsPath ??
      process.env.APITEST_SETTINGS ??
      path.join(process.cwd(), "tests", "appsettings.json");
    const raw = fs.readFileSync(resolved, "utf8");
    this.settings = JSON.parse(raw) as AppSettings;
  }

  getOptions(urlName: string): ApiTestOptions {
    const baseUrl = this.settings.ApiTest?.Urls?.[urlName]?.BaseUrl;
    if (!baseUrl) {
      throw new Error(
        \`appsettings.json is missing ApiTest.Urls.\${urlName}.BaseUrl\`,
      );
    }
    return { baseUrl };
  }

  resolveUrl(urlName: string, endpointPath: string): string {
    const { baseUrl } = this.getOptions(urlName);
    const trimmedBase = baseUrl.replace(/\\/+$/, "");
    const normalizedPath = endpointPath.startsWith("/")
      ? endpointPath
      : \`/\${endpointPath}\`;
    return \`\${trimmedBase}\${normalizedPath}\`;
  }

  async send(
    urlName: string,
    endpointPath: string,
    init: RequestInit,
  ): Promise<Response> {
    const url = this.resolveUrl(urlName, endpointPath);
    const method = (init.method ?? "GET").toUpperCase();
    return withRetry(() => withLogging(method, url, () => fetch(url, init)));
  }
}
`;
}

function apiTestCollection(): string {
  return `import { ApiTestFixture } from "../../src/automation-api/infrastructure/api-test-fixture";

/**
 * Singleton fixture shared by every generated API test file. Constructed
 * lazily on first import so test runs that override
 * \`process.env.APITEST_SETTINGS\` before importing test files pick the
 * right \`appsettings.json\`.
 */
export const apiTestFixture = new ApiTestFixture();
`;
}

/**
 * Scaffold a brand-new Node.js + Vitest API test solution. Layout:
 *
 *   {sln}/                                  ← rootPath
 *     package.json                          ← slnPath
 *     tsconfig.json
 *     .testbuilder.json                     ← solutionType: "api"
 *     src/automation-api/
 *       constants/api-endpoints.ts
 *       constants/test-collections.ts
 *       infrastructure/api-test-fixture.ts
 *       infrastructure/api-test-options.ts
 *       handlers/retry-handler.ts
 *       handlers/http-logging-handler.ts
 *       extensions/configuration-extensions.ts
 *     tests/
 *       appsettings.json
 *       infrastructure/api-test-collection.ts
 *       api-testing-assistants/             ← one assistant class per suite
 *       tests/                              ← test files land here
 */
export async function scaffoldApiNodejs(
  solutionName: string,
  _namespace: string,
): Promise<ApiScaffoldResult> {
  await fs.mkdir(recorderConfig.workspaceDir, { recursive: true });
  const rootPath = path.join(recorderConfig.workspaceDir, solutionName);
  await fs.mkdir(rootPath, { recursive: true });

  const helperDir = safeJoin(rootPath, NODEJS_API_HELPER_DIR);
  const testsDir = safeJoin(rootPath, NODEJS_API_TESTS_DIR);
  await fs.mkdir(safeJoin(helperDir, "constants"), { recursive: true });
  await fs.mkdir(safeJoin(helperDir, "infrastructure"), { recursive: true });
  await fs.mkdir(safeJoin(helperDir, "handlers"), { recursive: true });
  await fs.mkdir(safeJoin(helperDir, "extensions"), { recursive: true });
  await fs.mkdir(safeJoin(testsDir, "infrastructure"), { recursive: true });
  await fs.mkdir(safeJoin(testsDir, "api-testing-assistants"), {
    recursive: true,
  });
  await fs.mkdir(safeJoin(testsDir, "tests"), { recursive: true });
  // Task #196: per-suite Constants + TestCategories live alongside
  // `tests/` in the API solution. Pre-create both with .gitkeep so the
  // initial scaffold has the same shape as a populated project.
  await fs.mkdir(safeJoin(testsDir, "constants"), { recursive: true });
  await fs.mkdir(safeJoin(testsDir, "test-categories"), { recursive: true });
  await fs.writeFile(safeJoin(testsDir, "constants/.gitkeep"), "");
  await fs.writeFile(safeJoin(testsDir, "test-categories/.gitkeep"), "");

  // Root files.
  const slnPath = path.join(rootPath, "package.json");
  await fs.writeFile(slnPath, packageJson(solutionName));
  await fs.writeFile(path.join(rootPath, "tsconfig.json"), tsconfigJson());

  // Helper library.
  await fs.writeFile(
    safeJoin(helperDir, "constants/api-endpoints.ts"),
    apiEndpointsTs(),
  );
  await fs.writeFile(
    safeJoin(helperDir, "constants/test-collections.ts"),
    testCollections(),
  );
  await fs.writeFile(
    safeJoin(helperDir, "infrastructure/api-test-fixture.ts"),
    apiTestFixture(),
  );
  await fs.writeFile(
    safeJoin(helperDir, "infrastructure/api-test-options.ts"),
    apiTestOptions(),
  );
  await fs.writeFile(
    safeJoin(helperDir, "handlers/retry-handler.ts"),
    retryHandler(),
  );
  await fs.writeFile(
    safeJoin(helperDir, "handlers/http-logging-handler.ts"),
    httpLoggingHandler(),
  );
  await fs.writeFile(
    safeJoin(helperDir, "extensions/configuration-extensions.ts"),
    configurationExtensions(),
  );

  // Tests project.
  await fs.writeFile(
    safeJoin(testsDir, "appsettings.json"),
    appsettingsJson(),
  );
  await fs.writeFile(
    safeJoin(testsDir, "infrastructure/api-test-collection.ts"),
    apiTestCollection(),
  );
  await fs.writeFile(
    safeJoin(testsDir, "api-testing-assistants/.gitkeep"),
    "",
  );
  await fs.writeFile(safeJoin(testsDir, "tests/.gitkeep"), "");

  return {
    rootPath,
    slnPath,
    // Descriptive markers — the route uses these only as labels.
    helperProjectName: NODEJS_API_HELPER_DIR,
    // Set to "tests" so the existing `listApiBaseUrls` (which reads
    // `<rootPath>/<testProjectName>/appsettings.json`) finds the file
    // without any per-language branching.
    testProjectName: NODEJS_API_TESTS_DIR,
  };
}
