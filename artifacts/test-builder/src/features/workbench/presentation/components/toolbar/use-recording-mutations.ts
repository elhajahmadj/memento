import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useStopRecording,
  useFinalizeRecording,
  useForceDiscardRecording,
  useCancelOpenBrowser,
  discardRecordingSession,
  getGetProjectTreeQueryKey,
  getListTestClassesQueryKey,
  getGetRecordingStatusQueryKey,
} from "@workspace/api-client-react";
import { invalidateDiscoveredTests } from "@/features/workbench/presentation/lib/invalidate-discovered-tests";
import type { MethodCollision } from "./method-collision-dialog";

export interface StopResultPayload {
  status?: string;
  summary?: string | null;
  methodName?: string | null;
  suggestedName?: string | null;
  targetClass?: string | null;
  hookBackupPath?: string | null;
  submissionId?: string | null;
  submissionStatus?: string | null;
}

export function useRecordingMutations({
  onCollision,
  onCleared,
}: {
  onCollision: (c: MethodCollision, renameSeed: string) => void;
  onCleared: () => void;
}) {
  const qc = useQueryClient();

  const handleStopResult = async (res: StopResultPayload) => {
    if (res.status === "collision") {
      onCollision(
        {
          methodName: res.methodName ?? "",
          suggestedName: res.suggestedName ?? "",
          targetClass: res.targetClass ?? "",
        },
        res.suggestedName ?? "",
      );
      return;
    }
    if (res.submissionId) {
      toast.success(
        "Submitted to the SDET for approval. You'll see the decision on the home page.",
      );
    } else {
      toast.success(res.summary ?? "Recording stopped");
    }
    if (res.hookBackupPath) {
      toast.info(
        `Saved the previous hook body to ${res.hookBackupPath} in case you need to recover it.`,
        { duration: 10000 },
      );
    }
    onCleared();
    await Promise.all([
      qc.invalidateQueries({ queryKey: getGetProjectTreeQueryKey() }),
      qc.invalidateQueries({ queryKey: getListTestClassesQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetRecordingStatusQueryKey() }),
      qc.invalidateQueries({ queryKey: ["myApprovals"] }),
      invalidateDiscoveredTests(qc),
    ]);
  };

  const stop = useStopRecording({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({
          queryKey: getGetRecordingStatusQueryKey(),
        });
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to stop"),
    },
  });

  const finalize = useFinalizeRecording({
    mutation: {
      onSuccess: handleStopResult,
      onError: (e: Error) => toast.error(e.message ?? "Failed to finalize"),
    },
  });

  const forceDiscard = useForceDiscardRecording({
    mutation: {
      onSuccess: async (res) => {
        if (res.discarded) {
          toast.success(
            res.previousProjectName
              ? `Force-discarded the recording on ${res.previousProjectName}.`
              : "Force-discarded the recording.",
          );
        } else {
          toast.info("No recording session was active.");
        }
        await qc.invalidateQueries({
          queryKey: getGetRecordingStatusQueryKey(),
        });
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to force-discard recording"),
    },
  });

  const cancelOpenBrowser = useCancelOpenBrowser({
    mutation: {
      onSuccess: async () => {
        toast.success("Browser closed");
        await qc.invalidateQueries({
          queryKey: getGetRecordingStatusQueryKey(),
        });
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to close browser"),
    },
  });

  const discardSession = async () => {
    try {
      await discardRecordingSession();
      toast.success("Recording discarded");
      await qc.invalidateQueries({
        queryKey: getGetRecordingStatusQueryKey(),
      });
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to discard recording",
      );
    }
  };

  return {
    stop,
    finalize,
    forceDiscard,
    cancelOpenBrowser,
    discardSession,
  };
}
