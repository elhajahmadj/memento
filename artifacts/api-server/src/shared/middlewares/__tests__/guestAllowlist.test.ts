import { describe, it, expect, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  guestAllowlist,
  isGuestAllowed,
} from "@/shared/middlewares/guestAllowlist";

/**
 * The allow-list is the load-bearing guarantee for guest sessions: it
 * is what makes a newly-added endpoint closed to guests by default. The
 * matcher is pure, so most of this file exercises `isGuestAllowed`
 * directly; the middleware tests cover the role short-circuit and the
 * response shape.
 */

function makeCtx(role: string | null, method: string, path: string) {
  const req = {
    method,
    path,
    ...(role === null ? {} : { user: { role } }),
  } as unknown as Request;
  const json = vi.fn();
  const res = {
    status: vi.fn().mockReturnValue({ json }),
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next, json };
}

describe("isGuestAllowed", () => {
  it("allows the endpoints a guest needs to create, record, and export", () => {
    const allowed: Array<[string, string]> = [
      ["GET", "/auth/me"],
      ["POST", "/auth/logout"],
      ["POST", "/auth/guest"],
      ["GET", "/users/me/preferences"],
      ["PUT", "/users/me/preferences"],
      ["POST", "/projects"],
      ["GET", "/projects/current"],
      ["POST", "/projects/load"],
      ["GET", "/projects/available"],
      ["GET", "/projects/tree"],
      ["GET", "/projects/zip"],
      ["GET", "/tests"],
      ["GET", "/architectures"],
      ["POST", "/recording/start"],
      ["POST", "/recording/stop"],
      ["POST", "/recording/finalize"],
      ["POST", "/jmx/recording/start"],
      ["POST", "/codegen/test-class"],
      ["POST", "/files/rename"],
      ["GET", "/validation/recordings"],
      ["POST", "/validation/runs"],
      ["GET", "/dashboard/summary"],
    ];
    for (const [method, path] of allowed) {
      expect(isGuestAllowed(method, path), `${method} ${path}`).toBe(true);
    }
  });

  it("closes every AI endpoint", () => {
    const denied: Array<[string, string]> = [
      ["GET", "/ai-agent/keys"],
      ["POST", "/ai-agent/verify-key"],
      ["GET", "/ai-agent/projects/Foo/status"],
      ["POST", "/ai-agent/projects/Foo/runs"],
      ["GET", "/selectors/heal/ai-available"],
      ["POST", "/selectors/heal/ai-suggest"],
    ];
    for (const [method, path] of denied) {
      expect(isGuestAllowed(method, path), `${method} ${path}`).toBe(false);
    }
  });

  it("keeps the deterministic selector-heal paths open", () => {
    // The AI heal endpoints live under the same `/selectors/heal`
    // prefix, so this pair is the regression guard against someone
    // "simplifying" the rules into a `/selectors/heal/*` wildcard.
    expect(isGuestAllowed("POST", "/selectors/heal")).toBe(true);
    expect(isGuestAllowed("POST", "/selectors/heal/repick/start")).toBe(true);
    expect(isGuestAllowed("POST", "/selectors/heal/ai-suggest")).toBe(false);
  });

  it("closes the setup surfaces", () => {
    const denied: Array<[string, string]> = [
      ["GET", "/settings/hook-backup-retention"],
      ["PUT", "/settings/validation-trace-retention"],
      ["GET", "/route-mocks"],
      ["POST", "/route-mocks"],
      ["GET", "/shared-steps"],
      ["POST", "/shared-steps"],
    ];
    for (const [method, path] of denied) {
      expect(isGuestAllowed(method, path), `${method} ${path}`).toBe(false);
    }
  });

  it("closes admin, collaboration, and destructive project routes", () => {
    const denied: Array<[string, string]> = [
      ["GET", "/users"],
      ["POST", "/users/invite"],
      ["GET", "/audit"],
      ["GET", "/admin/internal-tests/suites"],
      ["GET", "/forks"],
      ["POST", "/forks/request"],
      ["GET", "/approvals/mine"],
      ["GET", "/project-assignments"],
      ["POST", "/project-access-requests"],
      ["GET", "/repo-pats"],
      ["GET", "/team/invitations"],
      ["GET", "/sso-denials"],
      ["POST", "/projects/delete"],
      ["POST", "/projects/clear-files"],
      ["POST", "/projects/disable"],
      ["POST", "/projects/clone"],
      ["POST", "/projects/demo"],
      ["POST", "/api-tests/build"],
      ["GET", "/projects/lifecycle-requests"],
      ["GET", "/projects/Foo/git-config"],
      ["GET", "/projects/Foo/branches"],
      ["GET", "/projects/pipeline-file"],
    ];
    for (const [method, path] of denied) {
      expect(isGuestAllowed(method, path), `${method} ${path}`).toBe(false);
    }
  });

  it("makes architectures read-only", () => {
    expect(isGuestAllowed("GET", "/architectures")).toBe(true);
    expect(isGuestAllowed("GET", "/architectures/default")).toBe(true);
    expect(isGuestAllowed("POST", "/architectures")).toBe(false);
    expect(isGuestAllowed("PUT", "/architectures/default")).toBe(false);
    expect(isGuestAllowed("POST", "/architectures/delete")).toBe(false);
  });

  it("matches `:param` rules against exactly one segment", () => {
    expect(isGuestAllowed("GET", "/validation/runs/abc-123")).toBe(true);
    expect(isGuestAllowed("GET", "/validation/runs/abc-123/trace")).toBe(true);
    // One segment too many — must not fall through to the shorter rule.
    expect(isGuestAllowed("GET", "/validation/runs/abc/trace/extra")).toBe(
      false,
    );
  });

  it("does not let a prefix rule leak past its own segment boundary", () => {
    expect(isGuestAllowed("POST", "/recording/start")).toBe(true);
    expect(isGuestAllowed("POST", "/recording-secrets")).toBe(false);
  });

  it("is method-sensitive", () => {
    expect(isGuestAllowed("GET", "/projects/available")).toBe(true);
    expect(isGuestAllowed("DELETE", "/projects/available")).toBe(false);
  });

  it("normalizes a trailing slash", () => {
    expect(isGuestAllowed("GET", "/auth/me/")).toBe(true);
  });
});

describe("guestAllowlist middleware", () => {
  it("is a pass-through for every non-guest role", () => {
    for (const role of ["memento_admin", "admin", "limited_admin", "limited"]) {
      // A path guests are denied — non-guests must still sail through.
      const { req, res, next } = makeCtx(role, "GET", "/ai-agent/keys");
      guestAllowlist(req, res, next);
      expect(next, role).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it("is a pass-through for unauthenticated requests", () => {
    const { req, res, next } = makeCtx(null, "GET", "/ai-agent/keys");
    guestAllowlist(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("lets an allow-listed guest request through", () => {
    const { req, res, next } = makeCtx("guest", "POST", "/projects");
    guestAllowlist(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("403s a guest on anything else, with a machine-readable code", () => {
    const { req, res, next, json } = makeCtx(
      "guest",
      "POST",
      "/ai-agent/verify-key",
    );
    guestAllowlist(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "GUEST_FORBIDDEN" }),
    );
  });
});
