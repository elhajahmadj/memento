/**
 * Backwards-compatible re-export. The bearer-auth middleware moved to
 * `features/auth/presentation/middleware/bearerAuth` as part of the
 * OIDC provider split; this shim keeps `@/shared/middlewares/bearerAuth`
 * imports working unchanged.
 */
export { bearerAuth } from "@/features/auth/presentation/middleware/bearerAuth";
