export type ViewportPreset = "1280x800" | "1440x900" | "1920x1080" | "custom";

export type RecentCategory = { constantName: string; value: string };

export type RecordingMode = "new" | "existing";

export type RecordingTarget = "testMethod" | "beforeEach" | "oneTimeSetup";

export type NamedUrl = { name: string; url: string };

export type SavedLoginInfo = { hasState: boolean; label: string | null };
