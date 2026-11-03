import { useEffect, useState } from "react";
import {
  RECENT_CATEGORIES_KEY,
  RECENT_IGNORE_REASONS_KEY,
  RECENT_LIMIT,
} from "./constants";
import type { RecentCategory } from "./types";

export function useRecentSuggestions() {
  const [recentCategories, setRecentCategories] = useState<RecentCategory[]>(
    [],
  );
  const [recentIgnoreReasons, setRecentIgnoreReasons] = useState<string[]>([]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawCats = window.localStorage.getItem(RECENT_CATEGORIES_KEY);
      if (rawCats) {
        const parsed = JSON.parse(rawCats) as unknown;
        if (Array.isArray(parsed)) {
          const cleaned: RecentCategory[] = [];
          for (const entry of parsed) {
            if (
              entry &&
              typeof entry === "object" &&
              typeof (entry as RecentCategory).constantName === "string" &&
              typeof (entry as RecentCategory).value === "string"
            ) {
              cleaned.push({
                constantName: (entry as RecentCategory).constantName,
                value: (entry as RecentCategory).value,
              });
            }
          }
          setRecentCategories(cleaned.slice(0, RECENT_LIMIT));
        }
      }
      const rawReasons = window.localStorage.getItem(RECENT_IGNORE_REASONS_KEY);
      if (rawReasons) {
        const parsed = JSON.parse(rawReasons) as unknown;
        if (Array.isArray(parsed)) {
          setRecentIgnoreReasons(
            parsed
              .filter((r): r is string => typeof r === "string")
              .slice(0, RECENT_LIMIT),
          );
        }
      }
    } catch {
      // ignore corrupt entries
    }
  }, []);
  return {
    recentCategories,
    setRecentCategories,
    recentIgnoreReasons,
    setRecentIgnoreReasons,
  };
}
