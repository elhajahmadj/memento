import { useEffect, useState } from "react";

export interface AssertionPrefillState {
  open: boolean;
  setOpen: (v: boolean) => void;
  initial: { selector: string; text: string } | null;
  insertBeforeIndex: number | null;
  reset: () => void;
}

/**
 * Centralizes the "Add assertion" dialog state along with the two
 * custom-event channels that let the live canvas (right-click "Assert
 * text on this element") and the recorded-action row ("insert before
 * this step") drive the same dialog with pre-filled values or a target
 * splice index.
 */
export function useAssertionPrefill(): AssertionPrefillState {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<{
    selector: string;
    text: string;
  } | null>(null);
  const [insertBeforeIndex, setInsertBeforeIndex] = useState<number | null>(
    null,
  );

  useEffect(() => {
    const handler = (ev: Event) => {
      const e = ev as CustomEvent<{ selector: string; text: string }>;
      setInitial({
        selector: e.detail?.selector ?? "",
        text: e.detail?.text ?? "",
      });
      setInsertBeforeIndex(null);
      setOpen(true);
    };
    const openWithInsert = (ev: Event) => {
      const e = ev as CustomEvent<{ insertBeforeIndex: number }>;
      const at =
        typeof e.detail?.insertBeforeIndex === "number"
          ? e.detail.insertBeforeIndex
          : null;
      setInitial(null);
      setInsertBeforeIndex(at);
      setOpen(true);
    };
    window.addEventListener(
      "recorder:assert-prefill",
      handler as EventListener,
    );
    window.addEventListener(
      "recorder:request-open-add-assertion",
      openWithInsert as EventListener,
    );
    return () => {
      window.removeEventListener(
        "recorder:assert-prefill",
        handler as EventListener,
      );
      window.removeEventListener(
        "recorder:request-open-add-assertion",
        openWithInsert as EventListener,
      );
    };
  }, []);

  return {
    open,
    setOpen,
    initial,
    insertBeforeIndex,
    reset: () => {
      setInitial(null);
      setInsertBeforeIndex(null);
    },
  };
}
