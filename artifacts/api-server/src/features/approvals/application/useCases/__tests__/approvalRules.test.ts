import { describe, it, expect } from "vitest";
import {
  ensureConflictsAcknowledged,
  ensureForkActive,
  ensurePending,
  resolveSelectedFiles,
} from "@/features/approvals/domain/approvalRules";

describe("approvalRules", () => {
  it("ensurePending allows pending and blocks decided", () => {
    expect(ensurePending("pending").kind).toBe("ok");
    const decided = ensurePending("approved");
    expect(decided.kind).toBe("err");
    if (decided.kind === "err") expect(decided.error.kind).toBe("conflict");
  });

  it("ensureForkActive requires status=active", () => {
    expect(ensureForkActive("active").kind).toBe("ok");
    const bad = ensureForkActive("merged");
    expect(bad.kind).toBe("err");
  });

  it("resolveSelectedFiles returns undefined when nothing requested", () => {
    const r = resolveSelectedFiles(undefined, new Set(["a.txt"]));
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.value).toBeUndefined();
  });

  it("resolveSelectedFiles rejects an empty list", () => {
    const r = resolveSelectedFiles([], new Set(["a.txt"]));
    expect(r.kind).toBe("err");
  });

  it("resolveSelectedFiles rejects unknown paths", () => {
    const r = resolveSelectedFiles(["nope.txt"], new Set(["a.txt"]));
    expect(r.kind).toBe("err");
  });

  it("resolveSelectedFiles narrows to the requested set", () => {
    const r = resolveSelectedFiles(
      ["a.txt"],
      new Set(["a.txt", "b.txt"]),
    );
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.value).toBeDefined();
      expect(Array.from(r.value!)).toEqual(["a.txt"]);
    }
  });

  it("ensureConflictsAcknowledged passes when no conflicts", () => {
    expect(ensureConflictsAcknowledged(0, false).kind).toBe("ok");
  });

  it("ensureConflictsAcknowledged requires ack when conflicts present", () => {
    const r = ensureConflictsAcknowledged(2, undefined);
    expect(r.kind).toBe("err");
  });

  it("ensureConflictsAcknowledged passes when ack=true", () => {
    expect(ensureConflictsAcknowledged(2, true).kind).toBe("ok");
  });
});
