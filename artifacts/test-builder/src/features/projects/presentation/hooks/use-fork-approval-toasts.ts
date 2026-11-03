import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ApprovalDto } from "@workspace/api-client-react";

const SEEN_APPROVAL_KEY = "tb.limited.seenApprovalDecisions.v1";

export function useForkApprovalToasts(approvals: ApprovalDto[] | undefined) {
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SEEN_APPROVAL_KEY);
      if (raw) seenRef.current = new Set(JSON.parse(raw) as string[]);
    } catch {
      // ignore corrupt storage
    }
  }, []);

  useEffect(() => {
    if (!approvals) return;
    const seen = seenRef.current;
    let dirty = false;
    for (const a of approvals) {
      if (a.status !== "approved" && a.status !== "rejected") continue;
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      dirty = true;
      if (a.status === "approved") {
        toast.success(`SDET approved your changes to ${a.projectName}`);
      } else {
        toast.error(
          a.comment
            ? `SDET rejected ${a.projectName}: ${a.comment}`
            : `SDET rejected your changes to ${a.projectName}`,
        );
      }
    }
    if (dirty) {
      try {
        window.localStorage.setItem(
          SEEN_APPROVAL_KEY,
          JSON.stringify(Array.from(seen)),
        );
      } catch {
        // storage full or disabled — toast was still shown
      }
    }
  }, [approvals]);
}
