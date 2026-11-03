/**
 * Merge an `ApiTest:Urls:{urlName}:BaseUrl` entry into the test project's
 * `appsettings.json`. Existing keys outside of `ApiTest.Urls.{urlName}` are
 * preserved verbatim; the URL block is created or its `BaseUrl` updated
 * idempotently.
 */
export function mergeAppSettings(
  source: string,
  urlName: string,
  baseUrl: string,
): string {
  let parsed: Record<string, unknown> = {};
  if (source.trim().length > 0) {
    try {
      parsed = JSON.parse(source) as Record<string, unknown>;
    } catch (e) {
      throw new Error(
        `appsettings.json is not valid JSON: ${(e as Error).message}`,
      );
    }
  }
  const apiTest =
    (parsed.ApiTest && typeof parsed.ApiTest === "object"
      ? (parsed.ApiTest as Record<string, unknown>)
      : null) ?? {};
  const urls =
    (apiTest.Urls && typeof apiTest.Urls === "object"
      ? (apiTest.Urls as Record<string, unknown>)
      : null) ?? {};
  const existing =
    (urls[urlName] && typeof urls[urlName] === "object"
      ? (urls[urlName] as Record<string, unknown>)
      : null) ?? {};
  urls[urlName] = { ...existing, BaseUrl: baseUrl };
  apiTest.Urls = urls;
  parsed.ApiTest = apiTest;
  return JSON.stringify(parsed, null, 2) + "\n";
}
