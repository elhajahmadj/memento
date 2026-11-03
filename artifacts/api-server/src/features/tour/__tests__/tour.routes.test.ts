import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";

let baseUrl: string;
let close: () => Promise<void>;
let cookie: string;
const USERNAME = "vitest-tour-user";

beforeAll(async () => {
  ({ baseUrl, close } = await bootServer());
  await provisionUser({ username: USERNAME, role: "admin" });
  cookie = await login(baseUrl, USERNAME);
});

afterAll(async () => {
  await deleteUserByUsername(USERNAME);
  await close();
});

describe("/users/me/tour-state + /users/me/tour-seen", () => {
  it("rejects unauthenticated GET", async () => {
    const res = await fetch(`${baseUrl}/api/users/me/tour-state`);
    expect(res.status).toBe(401);
  });

  it("defaults hasSeenTour to false for a brand-new user, then flips on POST", async () => {
    const initial = await fetch(`${baseUrl}/api/users/me/tour-state`, {
      headers: withCookie(cookie),
    });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({ hasSeenTour: false });

    const post = await fetch(`${baseUrl}/api/users/me/tour-seen`, {
      method: "POST",
      headers: withCookie(cookie, { "content-type": "application/json" }),
      body: JSON.stringify({ hasSeenTour: true }),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ hasSeenTour: true });

    const next = await fetch(`${baseUrl}/api/users/me/tour-state`, {
      headers: withCookie(cookie),
    });
    expect(await next.json()).toEqual({ hasSeenTour: true });
  });

  it("can be reset to false (Help → relaunch tour)", async () => {
    const res = await fetch(`${baseUrl}/api/users/me/tour-seen`, {
      method: "POST",
      headers: withCookie(cookie, { "content-type": "application/json" }),
      body: JSON.stringify({ hasSeenTour: false }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasSeenTour: false });
  });

  it("400s on a malformed body", async () => {
    const res = await fetch(`${baseUrl}/api/users/me/tour-seen`, {
      method: "POST",
      headers: withCookie(cookie, { "content-type": "application/json" }),
      body: JSON.stringify({ hasSeenTour: "yes" }),
    });
    expect(res.status).toBe(400);
  });
});
