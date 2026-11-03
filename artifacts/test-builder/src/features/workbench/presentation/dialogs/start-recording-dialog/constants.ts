import type { ViewportPreset } from "./types";

export const VIEWPORT_PRESETS: Record<
  Exclude<ViewportPreset, "custom">,
  { width: number; height: number; label: string }
> = {
  "1280x800": { width: 1280, height: 800, label: "Desktop (1280×800)" },
  "1440x900": { width: 1440, height: 900, label: "Large (1440×900)" },
  "1920x1080": { width: 1920, height: 1080, label: "Full HD (1920×1080)" },
};

export const VIEWPORT_STORAGE_KEY = "autoscriba.recordingViewport";
export const RECENT_CATEGORIES_KEY = "autoscriba.recentRecordingCategories";
export const RECENT_IGNORE_REASONS_KEY = "autoscriba.recentIgnoreReasons";
export const RECENT_LIMIT = 10;
