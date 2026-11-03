import type { ZodType } from "zod";
import { logger } from "@/shared/logger";

/**
 * Validate a route's outgoing response payload against the matching
 * generated `@workspace/api-zod` schema before it is sent to the
 * client. On a parse failure, log a structured error line naming the
 * route and the failing fields, then throw — the existing Express
 * error middleware turns the throw into a 500.
 *
 * The goal is to fail loudly server-side the next time a route's
 * response drifts from the OpenAPI contract, instead of letting the
 * mismatch reach the browser as a confusing render crash.
 */
export function assertResponseShape<T>(
  schema: ZodType<T>,
  value: unknown,
  route: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      code: i.code,
      message: i.message,
    }));
    logger.error(
      { route, issues },
      "AI Agent response schema mismatch",
    );
    throw new Error(
      `AI Agent response schema mismatch on ${route}: ${issues
        .map((i) => `${i.path || "(root)"} ${i.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}
