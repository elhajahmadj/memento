import { useEffect, useRef, useState } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

export interface PanelLayoutOptions {
  collapsedKey: string;
  widthKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

export interface PanelLayout {
  ref: React.RefObject<ImperativePanelHandle | null>;
  collapsed: boolean;
  defaultWidth: number;
  onCollapse: () => void;
  onExpand: () => void;
  onResize: (size: number) => void;
  collapse: () => void;
  expand: () => void;
}

function readPersistedWidth(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

/**
 * Manages a single collapsible side panel's persisted state. Tracks the
 * collapsed flag and last dragged width in localStorage under the
 * provided keys, and exposes imperative collapse/expand handles wired
 * to a `react-resizable-panels` `ImperativePanelHandle`.
 */
export function usePanelLayout(opts: PanelLayoutOptions): PanelLayout {
  const ref = useRef<ImperativePanelHandle>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(opts.collapsedKey) === "1";
  });
  const defaultWidth = useRef(
    readPersistedWidth(
      opts.widthKey,
      opts.defaultWidth,
      opts.minWidth,
      opts.maxWidth,
    ),
  ).current;

  useEffect(() => {
    window.localStorage.setItem(opts.collapsedKey, collapsed ? "1" : "0");
  }, [collapsed, opts.collapsedKey]);

  const onResize = (size: number) => {
    // react-resizable-panels fires onResize with 0 when a panel
    // collapses; skip those so we don't clobber the last dragged width.
    if (size <= 0) return;
    window.localStorage.setItem(opts.widthKey, String(size));
  };

  const collapse = () => {
    ref.current?.collapse();
    setCollapsed(true);
  };
  const expand = () => {
    ref.current?.expand();
    setCollapsed(false);
  };

  return {
    ref,
    collapsed,
    defaultWidth,
    onCollapse: () => setCollapsed(true),
    onExpand: () => setCollapsed(false),
    onResize,
    collapse,
    expand,
  };
}
