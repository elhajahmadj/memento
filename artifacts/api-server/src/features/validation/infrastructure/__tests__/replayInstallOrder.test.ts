import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Tier 3 mocks contract requires that any persistent
 * `Settings → Mocks` rules are installed on the Playwright `page`
 * BEFORE the first navigation/`page.goto(...)` of the run — otherwise
 * the very first request escapes the interception and hits the live
 * backend, defeating the whole determinism story.
 *
 * This is a static-source guard: it pins the call order in both the
 * recording session bootstrap and the replay run, without spinning up
 * a real Chromium (which is too heavy for a unit test).
 */
function indexOf(src: string, needle: string): number {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`expected source to contain ${JSON.stringify(needle)}`);
  return i;
}

describe("Tier 3 mocks install order", () => {
  it("recordingService installs persistent route mocks immediately after newPage(), before the session is returned", () => {
    const file = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "recording",
      "infrastructure",
      "sessionStart.ts",
    );
    const src = fs.readFileSync(file, "utf8");
    const newPageAt = indexOf(src, "context.newPage()");
    const installAt = src.indexOf("installPersistentRouteMocks(", newPageAt);
    const sessionCtorAt = src.indexOf("newSession: Session = {", newPageAt);
    expect(installAt).toBeGreaterThan(newPageAt);
    expect(sessionCtorAt).toBeGreaterThan(installAt);
  });

  it("replayService installs persistent route mocks before any hook or step replay", () => {
    const file = path.join(__dirname, "..", "executeReplay.ts");
    const src = fs.readFileSync(file, "utf8");
    const installAt = indexOf(src, "installPersistentRouteMocks(");
    const hookReplayAt = indexOf(src, "replayHookSets(");
    const stepReplayAt = indexOf(src, "replaySteps(");
    expect(installAt).toBeGreaterThan(0);
    expect(hookReplayAt).toBeGreaterThan(installAt);
    expect(stepReplayAt).toBeGreaterThan(installAt);
  });

  it("replayService surfaces a `mocks-installed` event when count > 0", () => {
    const file = path.join(__dirname, "..", "executeReplay.ts");
    const src = fs.readFileSync(file, "utf8");
    expect(src).toContain('"mocks-installed"');
    expect(src).toContain("installed > 0");
  });
});
