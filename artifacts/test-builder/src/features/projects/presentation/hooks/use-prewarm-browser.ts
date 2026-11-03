import { useCallback } from "react";
import { usePrewarmRecordingBrowser } from "@workspace/api-client-react";

/**
 * Returns a fire-and-forget `prewarm()` that asks the server to start
 * launching a headless browser now, so it is ready by the time the user
 * reaches the workbench and records. Called when the New Project dialog
 * opens or when an existing project is opened.
 *
 * Pre-warming is a pure latency optimization: if it fails the browser
 * just launches normally at record time, so errors are swallowed rather
 * than surfaced to the user.
 */
export function usePrewarmBrowser(): () => void {
  const { mutate } = usePrewarmRecordingBrowser();
  return useCallback(() => {
    mutate(undefined, { onError: () => {} });
  }, [mutate]);
}
