import {
  saveAuthState,
  type SavedAuthState,
} from "@/features/auth-states/infrastructure/authStateService";
import { getSession } from "@/features/recording/infrastructure/sessionState";

/**
 * Capture the live recorder context's storageState (cookies +
 * localStorage) and persist it for the (user, project). The session is
 * left running so the user can keep navigating, but the saved state is
 * already a complete logged-in snapshot suitable for `useSavedLogin`.
 */
export async function captureAndSaveAuthState(args: {
  userId: string;
  projectName: string;
  label: string;
}): Promise<SavedAuthState> {
  const session = getSession();
  if (!session) throw new Error("No active recording");
  if (session.userId !== args.userId) {
    throw new Error("Capture login is restricted to the session owner.");
  }
  if (session.phase !== "recording") {
    throw new Error(
      "Capture login requires the browser to still be live — use Start before stopping.",
    );
  }
  if (session.project.solutionName !== args.projectName) {
    throw new Error(
      "Active recording belongs to a different project than the requested capture.",
    );
  }
  const ctx = session.page.context();
  const state = await ctx.storageState();
  return saveAuthState({
    userId: args.userId,
    projectName: args.projectName,
    label: args.label,
    state,
  });
}
