import { execSync } from "node:child_process";
import { chromium, type Browser } from "playwright";

let cachedChromiumPath: string | undefined;

export function resolveChromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (cachedChromiumPath !== undefined) return cachedChromiumPath || undefined;
  try {
    cachedChromiumPath = execSync("which chromium", { encoding: "utf8" }).trim();
    return cachedChromiumPath;
  } catch {
    cachedChromiumPath = "";
    return undefined;
  }
}

export async function launchRecordingChromium(): Promise<Browser> {
  const executablePath = resolveChromiumPath();
  return chromium.launch({
    headless: true,
    chromiumSandbox: false,
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}
