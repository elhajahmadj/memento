import { useEffect, useState } from "react";
import { VIEWPORT_STORAGE_KEY } from "./constants";
import type { ViewportPreset } from "./types";

export function useViewport() {
  const [viewportPreset, setViewportPreset] = useState<ViewportPreset>(
    "1280x800",
  );
  const [viewportW, setViewportW] = useState<number>(1280);
  const [viewportH, setViewportH] = useState<number>(800);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(VIEWPORT_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        preset?: ViewportPreset;
        width?: number;
        height?: number;
      };
      if (saved.preset) setViewportPreset(saved.preset);
      if (typeof saved.width === "number") setViewportW(saved.width);
      if (typeof saved.height === "number") setViewportH(saved.height);
    } catch {
      // ignore corrupt entries
    }
  }, []);
  const viewportInRange =
    viewportW >= 320 &&
    viewportW <= 3840 &&
    viewportH >= 240 &&
    viewportH <= 2160;
  return {
    viewportPreset,
    setViewportPreset,
    viewportW,
    setViewportW,
    viewportH,
    setViewportH,
    viewportInRange,
  };
}
