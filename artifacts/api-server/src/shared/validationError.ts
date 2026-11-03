import type { Response } from "express";

/**
 * Structural shape of the part of a `ZodError` we read.
 *
 * Deliberately not `ZodError<T>`: that type is invariant in its generic,
 * so under this project's `exactOptionalPropertyTypes` a
 * `ZodError<{ path: string }>` is not assignable to `ZodError<unknown>`
 * and every call site would need its own type argument. All we need is
 * the issue paths.
 */
interface ZodLikeError {
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number | symbol> }>;
}

/**
 * Standard 400 body for a failed zod parse (audit finding M-11).
 *
 * Route handlers used to return `parsed.error.message` verbatim. That
 * message enumerates field paths, expected types, and union members —
 * i.e. a readable description of the internal schema. Combined with the
 * reflective CORS policy (C-3), it was remotely harvestable from any
 * origin, and it lowers the cost of every other attack by removing the
 * guesswork about which fields exist and what they accept.
 *
 * What a legitimate client actually needs is *which fields* were wrong,
 * not the schema's shape, so that is what this returns. The full zod
 * error stays server-side in the log.
 */
export function validationErrorBody(error: ZodLikeError): {
  error: string;
  code: string;
  fields: string[];
} {
  const fields = [
    ...new Set(
      error.issues
        .map((issue) => issue.path.map(String).join("."))
        .filter((path) => path.length > 0),
    ),
  ].slice(0, 25);
  return {
    error: "Invalid request.",
    code: "VALIDATION_FAILED",
    ...(fields.length > 0 ? { fields } : { fields: [] }),
  };
}

/**
 * Send the standard 400. Logs the full zod error when the response has a
 * request logger attached, so the detail is still available server-side
 * and correlated by request id.
 */
export function respondValidationError(res: Response, error: ZodLikeError): void {
  const log = (res.req as { log?: { warn: (o: unknown, m: string) => void } })
    ?.log;
  log?.warn({ issues: error.issues }, "request failed validation");
  res.status(400).json(validationErrorBody(error));
}
