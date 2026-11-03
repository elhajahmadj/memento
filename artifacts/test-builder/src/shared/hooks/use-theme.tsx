import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark" | "grey";

const STORAGE_KEY = "test-builder-theme";
const DEFAULT_THEME: ThemeMode = "dark";
const THEME_CYCLE: readonly ThemeMode[] = ["dark", "light", "grey"] as const;

function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "grey") {
      return stored;
    }
  } catch {
    // localStorage may be unavailable (private mode, etc.)
  }
  return DEFAULT_THEME;
}

function applyThemeClass(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const cls = document.documentElement.classList;
  cls.toggle("dark", mode === "dark");
  cls.toggle("grey", mode === "grey");
}

// Apply the chosen theme as early as possible (at module load) to reduce flash
// before React mounts.
if (typeof document !== "undefined") {
  applyThemeClass(readStoredTheme());
}

type ThemeContextValue = {
  theme: ThemeMode;
  isDark: boolean;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme());

  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore storage failures; in-memory state still updates
    }
    setThemeState(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const idx = THEME_CYCLE.indexOf(current);
      const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length] ?? DEFAULT_THEME;
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const isDark = theme === "dark";

  return (
    <ThemeContext.Provider value={{ theme, isDark, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}

export function useIsDarkTheme(): boolean {
  return useTheme().isDark;
}
