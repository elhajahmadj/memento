/**
 * Whether the api-server is running in a developer-friendly environment.
 * Used to gate the `/auth/dev-login` shortcut so production deployments
 * never expose the no-password fast user switch.
 */
export function isDevEnvironment(): boolean {
  const env = (process.env.APP_ENVIRONMENT || "").toLowerCase();
  return env === "local" || env === "development";
}
