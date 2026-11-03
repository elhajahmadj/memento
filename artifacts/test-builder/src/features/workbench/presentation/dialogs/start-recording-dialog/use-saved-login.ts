import { useEffect, useState } from "react";
import type { SavedLoginInfo } from "./types";

export function useSavedLogin(open: boolean) {
  const [savedLoginInfo, setSavedLoginInfo] = useState<SavedLoginInfo | null>(
    null,
  );
  const [useSavedLogin, setUseSavedLogin] = useState(false);
  useEffect(() => {
    if (!open) return;
    fetch("/api/auth-state", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: SavedLoginInfo | null) => {
        setSavedLoginInfo(j);
        if (!j?.hasState) setUseSavedLogin(false);
      })
      .catch(() => setSavedLoginInfo(null));
  }, [open]);
  return { savedLoginInfo, useSavedLogin, setUseSavedLogin };
}
