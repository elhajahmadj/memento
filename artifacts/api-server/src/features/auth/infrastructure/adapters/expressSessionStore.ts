import type { Request } from "express";
import type { AuthSessionData, SessionStore } from "../../domain/ports";

/**
 * Per-request adapter that wraps `req.session` (express-session) behind
 * the {@link SessionStore} port. Constructed inside route handlers; the
 * use case then talks to it instead of touching express-session APIs
 * directly.
 *
 * Only the fields declared on {@link AuthSessionData} round-trip through
 * `data` — that union is the contract the auth use cases depend on.
 * Any new session fields needed by auth must be added there *and* on
 * the express-session module augmentation that the rest of the server
 * already relies on.
 */
export class ExpressSessionStore implements SessionStore {
  // The proxy's `get`/`set` traps target `req.session` directly so
  // assignments inside the use case actually mutate express-session.
  readonly data: AuthSessionData;

  constructor(private readonly req: Request) {
    // Always resolve through `req.session` lazily — express-session
    // *replaces* the session object on `regenerate()`, so a captured
    // reference would silently keep writing to the old session and
    // those writes would never round-trip to the new cookie.
    const live = () => req.session as unknown as Record<string, unknown>;
    this.data = new Proxy({} as AuthSessionData, {
      get: (_t, prop) => live()[prop as string],
      set: (_t, prop, value) => {
        live()[prop as string] = value;
        return true;
      },
      deleteProperty: (_t, prop) => {
        delete live()[prop as string];
        return true;
      },
      has: (_t, prop) => prop in live(),
      ownKeys: () => Reflect.ownKeys(live()),
      getOwnPropertyDescriptor: (_t, prop) =>
        Object.getOwnPropertyDescriptor(live(), prop),
    });
  }

  regenerate(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
  }

  save(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.req.session.save((err) => (err ? reject(err) : resolve()));
    });
  }

  destroy(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.req.session.destroy((err) => (err ? reject(err) : resolve()));
    });
  }
}
