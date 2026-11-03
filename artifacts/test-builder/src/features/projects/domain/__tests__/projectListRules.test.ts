import { describe, expect, it } from "vitest";
import {
  approvedDirectProjects,
  extractMutationErrorMessage,
  groupApprovalsByProject,
  isOpenBrowserActive,
  isPendingProjectResponse,
  latestApprovalByProject,
  pendingCreateRequestIdsByProject,
  pendingCreateRequests,
  visibleAvailableProjects,
} from "../projectListRules";

describe("visibleAvailableProjects", () => {
  it("returns [] for nullish input", () => {
    expect(visibleAvailableProjects(undefined)).toEqual([]);
    expect(visibleAvailableProjects(null)).toEqual([]);
  });

  it("filters out disabled projects, preserves order, keeps non-disabled untouched", () => {
    const projects = [
      { name: "a", disabled: false },
      { name: "b", disabled: true },
      { name: "c" },
      { name: "d", disabled: true },
    ];
    expect(visibleAvailableProjects(projects).map((p) => p.name)).toEqual([
      "a",
      "c",
    ]);
  });
});

describe("approvedDirectProjects", () => {
  it("returns [] when input is not an array", () => {
    expect(approvedDirectProjects(undefined)).toEqual([]);
    expect(approvedDirectProjects(null)).toEqual([]);
  });

  it("keeps only hasAccess && !pendingApproval", () => {
    const projects = [
      { name: "a", hasAccess: true },
      { name: "b", hasAccess: true, pendingApproval: true },
      { name: "c", hasAccess: false },
      { name: "d", hasAccess: true, pendingApproval: false },
    ];
    expect(approvedDirectProjects(projects).map((p) => p.name)).toEqual([
      "a",
      "d",
    ]);
  });
});

describe("pendingCreateRequests / pendingCreateRequestIdsByProject", () => {
  const reqs = [
    { id: "1", kind: "create", projectName: "p1" },
    { id: "2", kind: "delete", projectName: "p2" },
    { id: "3", kind: "create", projectName: "p3" },
  ];

  it("returns only kind === 'create'", () => {
    expect(pendingCreateRequests(reqs).map((r) => r.id)).toEqual(["1", "3"]);
    expect(pendingCreateRequests(undefined)).toEqual([]);
  });

  it("builds a project -> id Map", () => {
    const map = pendingCreateRequestIdsByProject(reqs);
    expect(map.get("p1")).toBe("1");
    expect(map.get("p3")).toBe("3");
    expect(map.has("p2")).toBe(false);
  });
});

describe("groupApprovalsByProject / latestApprovalByProject", () => {
  const approvals = [
    { projectName: "a", submittedAt: "2024-01-01T00:00:00Z", n: 1 },
    { projectName: "a", submittedAt: "2024-03-01T00:00:00Z", n: 2 },
    { projectName: "b", submittedAt: "2024-02-01T00:00:00Z", n: 3 },
  ];

  it("groups and sorts newest-first regardless of input order", () => {
    const grouped = groupApprovalsByProject(approvals);
    expect(grouped.get("a")?.map((a) => a.n)).toEqual([2, 1]);
    expect(grouped.get("b")?.map((a) => a.n)).toEqual([3]);
  });

  it("latestApprovalByProject picks the newest", () => {
    const latest = latestApprovalByProject(groupApprovalsByProject(approvals));
    expect(latest.get("a")?.n).toBe(2);
    expect(latest.get("b")?.n).toBe(3);
  });

  it("tolerates nullish input", () => {
    expect(groupApprovalsByProject(undefined).size).toBe(0);
  });
});

describe("isOpenBrowserActive", () => {
  it("true only when phase=recording and no methodName/targetClass", () => {
    expect(isOpenBrowserActive({ phase: "recording" })).toBe(true);
    expect(
      isOpenBrowserActive({ phase: "recording", methodName: "foo" }),
    ).toBe(false);
    expect(
      isOpenBrowserActive({ phase: "recording", targetClass: "X" }),
    ).toBe(false);
    expect(isOpenBrowserActive({ phase: "idle" })).toBe(false);
    expect(isOpenBrowserActive(undefined)).toBe(false);
    expect(isOpenBrowserActive(null)).toBe(false);
  });
});

describe("isPendingProjectResponse", () => {
  it("true only when the object has pending===true", () => {
    expect(isPendingProjectResponse({ pending: true })).toBe(true);
    expect(isPendingProjectResponse({ pending: false })).toBe(false);
    expect(isPendingProjectResponse({})).toBe(false);
    expect(isPendingProjectResponse(undefined)).toBe(false);
    expect(isPendingProjectResponse("pending")).toBe(false);
  });
});

describe("extractMutationErrorMessage", () => {
  it("prefers Orval-style data.message", () => {
    expect(
      extractMutationErrorMessage({ data: { message: "boom" } }, "fallback"),
    ).toBe("boom");
  });

  it("falls back to Error.message", () => {
    expect(extractMutationErrorMessage(new Error("nope"), "fallback")).toBe(
      "nope",
    );
  });

  it("returns the fallback when nothing else fits", () => {
    expect(extractMutationErrorMessage({}, "fallback")).toBe("fallback");
    expect(extractMutationErrorMessage(null, "fallback")).toBe("fallback");
    expect(extractMutationErrorMessage(new Error(""), "fallback")).toBe(
      "fallback",
    );
  });
});
