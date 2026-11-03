import { describe, expect, it } from "vitest";
import type { ValidationRunDto } from "@workspace/api-client-react";
import {
  describeStep,
  fmtDuration,
  fmtRelative,
  groupKeyFor,
  recordingLabel,
  summarizeByTest,
  type RunStep,
} from "../validation-run-rules";

const NOW = new Date("2026-05-01T12:00:00Z").getTime();
const at = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString();

function run(
  overrides: Partial<ValidationRunDto> & Pick<ValidationRunDto, "id">,
): ValidationRunDto {
  return {
    id: overrides.id,
    projectName: "Acme",
    recordingFilePath: "tests/login.spec.ts",
    recordingKind: "playwright",
    recordingMethodName: "logsIn",
    status: "passed",
    queuedAt: at(5),
    startedAt: at(5),
    finishedAt: at(4),
    summary: {},
    traceRef: null,
    triggeredByUserId: "u1",
    parentRunId: null,
    ...overrides,
  } as ValidationRunDto;
}

describe("fmtDuration", () => {
  it("returns em-dash when either timestamp is missing", () => {
    expect(fmtDuration(null, "2026-05-01T00:00:00Z")).toBe("—");
    expect(fmtDuration("2026-05-01T00:00:00Z", null)).toBe("—");
  });
  it("returns em-dash when end is before start", () => {
    expect(
      fmtDuration("2026-05-01T00:00:05Z", "2026-05-01T00:00:00Z"),
    ).toBe("—");
  });
  it("formats sub-second durations as ms", () => {
    expect(
      fmtDuration("2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.500Z"),
    ).toBe("500ms");
  });
  it("formats sub-minute as seconds", () => {
    expect(
      fmtDuration("2026-05-01T00:00:00Z", "2026-05-01T00:00:12Z"),
    ).toBe("12.0s");
  });
  it("formats minute-plus as m and s", () => {
    expect(
      fmtDuration("2026-05-01T00:00:00Z", "2026-05-01T00:01:30Z"),
    ).toBe("1m 30s");
  });
});

describe("fmtRelative", () => {
  it("returns 'just now' under 1 minute", () => {
    expect(fmtRelative(new Date(NOW - 30_000).toISOString(), NOW)).toBe(
      "just now",
    );
  });
  it("returns minutes ago for under 1 hour", () => {
    expect(fmtRelative(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe(
      "5m ago",
    );
  });
  it("returns hours ago for under 1 day", () => {
    expect(
      fmtRelative(new Date(NOW - 3 * 3_600_000).toISOString(), NOW),
    ).toBe("3h ago");
  });
});

describe("recordingLabel", () => {
  it("returns '(all tests)' when no file path", () => {
    expect(recordingLabel(run({ id: "r", recordingFilePath: null }))).toBe(
      "(all tests)",
    );
  });
  it("returns just the basename when no method name", () => {
    expect(
      recordingLabel(
        run({
          id: "r",
          recordingFilePath: "a/b/c/foo.spec.ts",
          recordingMethodName: null,
        }),
      ),
    ).toBe("foo.spec.ts");
  });
  it("joins basename and method with the chevron", () => {
    expect(
      recordingLabel(
        run({
          id: "r",
          recordingFilePath: "a/b/foo.spec.ts",
          recordingMethodName: "logsIn",
        }),
      ),
    ).toBe("foo.spec.ts › logsIn");
  });
});

describe("groupKeyFor", () => {
  it("encodes file path + method name", () => {
    expect(
      groupKeyFor(
        run({
          id: "r",
          recordingFilePath: "tests/x.spec.ts",
          recordingMethodName: "doIt",
        }),
      ),
    ).toBe("tests/x.spec.ts::doIt");
  });
  it("encodes <all> for null file path", () => {
    expect(
      groupKeyFor(
        run({
          id: "r",
          recordingFilePath: null,
          recordingMethodName: null,
        }),
      ),
    ).toBe("<all>::");
  });
});

describe("describeStep", () => {
  const base: RunStep = {
    index: 0,
    type: "",
    selector: null,
    value: null,
    status: "pending",
    durationMs: null,
    error: null,
  };
  it("describes navigate with value", () => {
    expect(describeStep({ ...base, type: "navigate", value: "/home" })).toBe(
      "navigate /home",
    );
  });
  it("describes assert with kind, selector, value", () => {
    expect(
      describeStep({
        ...base,
        type: "assert",
        assertKind: "visible",
        selector: "#x",
        value: "true",
      }),
    ).toBe("assert (visible) #x → true");
  });
  it("describes assert with just selector", () => {
    expect(
      describeStep({
        ...base,
        type: "assert",
        assertKind: "exists",
        selector: "#x",
      }),
    ).toBe("assert (exists) #x");
  });
  it("describes generic step with selector + value", () => {
    expect(
      describeStep({ ...base, type: "fill", selector: "#in", value: "hi" }),
    ).toBe("fill #in ↳ hi");
  });
  it("falls back to type alone", () => {
    expect(describeStep({ ...base, type: "click" })).toBe("click");
  });
});

describe("summarizeByTest", () => {
  it("skips parent-of-all rows", () => {
    const groups = summarizeByTest(
      [
        run({ id: "p", parentRunId: null, recordingFilePath: null }),
        run({ id: "c1", parentRunId: "p" }),
      ],
      NOW,
    );
    // parent has null recordingFilePath, child has parentRunId — both excluded.
    expect(groups).toHaveLength(0);
  });

  it("excludes runs older than the trend window", () => {
    const groups = summarizeByTest(
      [run({ id: "old", queuedAt: at(60 * 24 * 60) })],
      NOW,
    );
    expect(groups).toHaveLength(0);
  });

  it("computes pass-rate and flakiness over alternating outcomes", () => {
    const groups = summarizeByTest(
      [
        run({ id: "r3", status: "passed", queuedAt: at(5) }),
        run({ id: "r2", status: "failed", queuedAt: at(15) }),
        run({ id: "r1", status: "passed", queuedAt: at(30) }),
      ],
      NOW,
    );
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.finishedInWindow).toBe(3);
    expect(g.passesInWindow).toBe(2);
    expect(g.failsInWindow).toBe(1);
    expect(g.passRate).toBeCloseTo(2 / 3);
    // Two consecutive flips out of two adjacent pairs = 100%.
    expect(g.flakiness).toBe(1);
  });

  it("returns 0 flakiness for a single finished run", () => {
    const groups = summarizeByTest(
      [run({ id: "r1", status: "passed" })],
      NOW,
    );
    expect(groups[0]!.flakiness).toBe(0);
  });

  it("treats 'error' as a failure for flakiness purposes", () => {
    const groups = summarizeByTest(
      [
        run({ id: "r3", status: "passed", queuedAt: at(5) }),
        run({ id: "r2", status: "error", queuedAt: at(15) }),
      ],
      NOW,
    );
    expect(groups[0]!.failsInWindow).toBe(1);
    expect(groups[0]!.flakiness).toBe(1);
  });

  it("orders groups by most-recent latest run first", () => {
    const groups = summarizeByTest(
      [
        run({
          id: "a",
          recordingFilePath: "a.spec.ts",
          recordingMethodName: "a",
          queuedAt: at(60),
        }),
        run({
          id: "b",
          recordingFilePath: "b.spec.ts",
          recordingMethodName: "b",
          queuedAt: at(5),
        }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual([
      "b.spec.ts::b",
      "a.spec.ts::a",
    ]);
  });
});
