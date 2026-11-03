import { loadAuthStateStorageState } from "@/features/auth-states/infrastructure/authStateService";
import type { AuthStateLoader } from "../application/ports";

export function createAuthStateLoaderAdapter(): AuthStateLoader {
  return {
    async load({ userId, projectName }) {
      try {
        // Decrypts the stored payload (H-2). A row that cannot be
        // decrypted comes back null, which this port already treats as
        // "no saved login".
        return await loadAuthStateStorageState({ userId, projectName });
      } catch {
        return null;
      }
    },
  };
}
