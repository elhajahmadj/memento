/**
 * Base error shapes used in `Result<T, E>` errors across the monorepo.
 *
 * These are intentionally plain interfaces (not classes) so they
 * serialize cleanly across the wire, are cheap to construct, and stay
 * framework-agnostic. Domain modules typically declare their own
 * narrower union types and use these as building blocks.
 */

/** Discriminant for the kinds of errors we model. */
export type AppErrorKind =
  | "validation"
  | "not_found"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "infrastructure"
  | "unknown";

export interface AppErrorBase<K extends AppErrorKind = AppErrorKind> {
  readonly kind: K;
  readonly message: string;
  /** Optional cause for diagnostic logging. Never sent to clients verbatim. */
  readonly cause?: unknown;
}

export interface ValidationError extends AppErrorBase<"validation"> {
  /** Field-level details so callers can surface form errors. */
  readonly details?: ReadonlyArray<{ path: string; message: string }>;
}

export interface NotFoundError extends AppErrorBase<"not_found"> {
  readonly resource: string;
  readonly id?: string;
}

export interface UnauthorizedError extends AppErrorBase<"unauthorized"> {}

export interface ForbiddenError extends AppErrorBase<"forbidden"> {}

export interface ConflictError extends AppErrorBase<"conflict"> {}

export interface InfrastructureError extends AppErrorBase<"infrastructure"> {}

export interface UnknownError extends AppErrorBase<"unknown"> {}

export type AppError =
  | ValidationError
  | NotFoundError
  | UnauthorizedError
  | ForbiddenError
  | ConflictError
  | InfrastructureError
  | UnknownError;

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export const validationError = (
  message: string,
  details?: ReadonlyArray<{ path: string; message: string }>,
): ValidationError => ({
  kind: "validation",
  message,
  ...(details !== undefined ? { details } : {}),
});

export const notFoundError = (
  resource: string,
  id?: string,
  message?: string,
): NotFoundError => ({
  kind: "not_found",
  resource,
  ...(id !== undefined ? { id } : {}),
  message: message ?? `${resource} not found`,
});

export const unauthorizedError = (
  message = "Unauthorized",
): UnauthorizedError => ({ kind: "unauthorized", message });

export const forbiddenError = (message = "Forbidden"): ForbiddenError => ({
  kind: "forbidden",
  message,
});

export const conflictError = (message: string): ConflictError => ({
  kind: "conflict",
  message,
});

export const infrastructureError = (
  message: string,
  cause?: unknown,
): InfrastructureError => ({
  kind: "infrastructure",
  message,
  ...(cause !== undefined ? { cause } : {}),
});

export const unknownError = (
  message = "Unknown error",
  cause?: unknown,
): UnknownError => ({
  kind: "unknown",
  message,
  ...(cause !== undefined ? { cause } : {}),
});

/**
 * Default mapping from an `AppError` to an HTTP status. Presentation
 * layers can override this per-route when finer control is needed.
 */
export const httpStatusForAppError = (e: AppError): number => {
  switch (e.kind) {
    case "validation":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "infrastructure":
      return 502;
    case "unknown":
      return 500;
  }
};
