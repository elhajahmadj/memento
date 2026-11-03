import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Separator } from "@/shared/ui/separator";
import { toast } from "sonner";
import {
  Loader2,
  Play,
  ListChecks,
} from "lucide-react";
import { FixSelectorDialog } from "../dialogs/fix-selector-dialog";
import type { FixSelectorContext } from "../dialogs/fix-selector/types";
import {
  listValidationRecordings,
  startValidationRun,
  startValidationRunFromSession,
  startValidateAll,
  type RecordedRecordingDto,
} from "@workspace/api-client-react";
import {
  recordingLabel,
  wsUrlFor,
} from "./validation-panel/helpers";
import type { RunState } from "./validation-panel/types";
import { reduceRunEvent } from "./validation-panel/apply-event";
import { RecordingListItem } from "./validation-panel/recording-list-item";
import { RunRow } from "./validation-panel/run-row";

export function ValidationPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [recordings, setRecordings] = useState<RecordedRecordingDto[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [healTarget, setHealTarget] = useState<FixSelectorContext | null>(
    null,
  );
  const [healInitialTab, setHealInitialTab] = useState<
    "ai" | "repick" | "advanced"
  >("ai");
  const socketsRef = useRef<Record<string, WebSocket>>({});

  useEffect(() => {
    if (!open) return;
    setLoadingList(true);
    listValidationRecordings()
      .then((r) => setRecordings(r))
      .catch((e) => toast.error(e.message ?? "Failed to load recordings"))
      .finally(() => setLoadingList(false));
  }, [open]);

  // Allow other parts of the workbench (e.g. inline "Validate" buttons in
  // the right panel) to start a run without the user opening the sheet
  // first. We refetch recordings here because the cached `recordings`
  // state may be empty if the panel was never opened, and the parent has
  // already toggled the sheet open in parallel with dispatching this
  // event.
  useEffect(() => {
    const handler = async (ev: Event) => {
      const e = ev as CustomEvent<{ filePath: string; methodName?: string }>;
      const filePath = e.detail?.filePath;
      const methodName = e.detail?.methodName;
      if (!filePath) return;
      setLoadingList(true);
      try {
        const recs = await listValidationRecordings();
        setRecordings(recs);
        const match = methodName
          ? recs.find(
              (r) =>
                r.filePath === filePath &&
                r.kind === "testMethod" &&
                r.methodName === methodName,
            )
          : recs.find(
              (r) => r.filePath === filePath && r.kind === "testMethod",
            ) ?? recs.find((r) => r.filePath === filePath);
        if (!match) {
          toast.error(
            methodName
              ? `No saved recording for ${methodName} yet — record it first.`
              : "No saved recording for this test class yet — record one first.",
          );
          return;
        }
        await runOne(match);
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to start validation");
      } finally {
        setLoadingList(false);
      }
    };
    window.addEventListener(
      "validation:trigger-class",
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        "validation:trigger-class",
        handler as EventListener,
      );
  }, []);

  // Workbench's "Validate" button on a STOPPED recording dispatches this
  // event. We refetch the recording list (so the synthetic session entry
  // is reflected and any other in-flight state is current) and then
  // start the dedicated session run.
  useEffect(() => {
    const handler = async () => {
      setLoadingList(true);
      try {
        const recs = await listValidationRecordings();
        setRecordings(recs);
        const session = recs.find((r) => r.source === "session");
        if (!session) {
          toast.error(
            "No stopped recording session to validate. Stop the recording first.",
          );
          return;
        }
        await runOne(session);
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to start validation");
      } finally {
        setLoadingList(false);
      }
    };
    window.addEventListener(
      "validation:trigger-session",
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        "validation:trigger-session",
        handler as EventListener,
      );
  }, []);

  useEffect(() => {
    return () => {
      Object.values(socketsRef.current).forEach((s) => {
        try {
          s.close();
        } catch {
          /* noop */
        }
      });
      socketsRef.current = {};
    };
  }, []);

  const attachSocket = (id: string, label: string) => {
    setRuns((prev) => ({
      ...prev,
      [id]: prev[id] ?? {
        id,
        label,
        status: "connecting",
        steps: [],
      },
    }));
    setOrder((prev) => (prev.includes(id) ? prev : [id, ...prev]));
    const ws = new WebSocket(wsUrlFor(id));
    socketsRef.current[id] = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        applyEvent(id, msg);
      } catch {
        /* noop */
      }
    };
    ws.onerror = () => {
      setRuns((prev) => ({
        ...prev,
        [id]: {
          ...(prev[id] ?? { id, label, status: "error", steps: [] }),
          status: "error",
          message: "WebSocket error",
        },
      }));
    };
    ws.onclose = () => {
      delete socketsRef.current[id];
    };
  };

  const applyEvent = (id: string, msg: Record<string, unknown>) => {
    setRuns((prev) => {
      const cur =
        prev[id] ??
        ({ id, label: id, status: "running", steps: [] } as RunState);
      return { ...prev, [id]: reduceRunEvent(cur, msg) };
    });
  };

  const runOne = async (r: RecordedRecordingDto) => {
    try {
      // The unsaved in-memory session uses a dedicated endpoint that
      // reads the actions from process memory; persisted recordings hit
      // the regular start route keyed by (filePath, kind, methodName).
      const { id } =
        r.source === "session"
          ? await startValidationRunFromSession()
          : await startValidationRun({
              filePath: r.filePath,
              kind: r.kind,
              methodName: r.methodName,
            });
      attachSocket(id, recordingLabel(r));
    } catch (e) {
      toast.error((e as Error).message ?? "Failed to start validation");
    }
  };

  const runAll = async () => {
    try {
      const { id } = await startValidateAll();
      attachSocket(id, "Validate all");
    } catch (e) {
      toast.error((e as Error).message ?? "Failed to start validate-all");
    }
  };

  const orderedRuns = useMemo(
    () => order.map((id) => runs[id]).filter(Boolean) as RunState[],
    [order, runs],
  );

  // Backend enforces a single in-flight validation run per project; mirror
  // that here so the UI doesn't let the user spam buttons that will 409.
  const isAnyRunActive = useMemo(
    () =>
      orderedRuns.some(
        (r) =>
          r.status === "connecting" ||
          r.status === "running" ||
          r.status === "queued",
      ),
    [orderedRuns],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[640px] max-w-[90vw] flex flex-col"
        data-testid="sheet-validation-panel"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4" /> Validate recordings
          </SheetTitle>
          <SheetDescription>
            Replays each saved recording in a headless browser to confirm it
            still passes. Recordings can only be validated against URLs the
            server can reach over the public internet.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 mt-4">
          <Button
            size="sm"
            onClick={runAll}
            disabled={recordings.length === 0 || isAnyRunActive}
            data-testid="button-validate-all"
          >
            <Play className="h-4 w-4 mr-2 fill-current" />
            Validate all ({recordings.length})
          </Button>
          {isAnyRunActive && (
            <span className="text-xs text-muted-foreground">
              A validation run is in progress for this project.
            </span>
          )}
          {loadingList && (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading recordings…
            </span>
          )}
        </div>

        <Separator className="my-3" />

        <div className="text-xs uppercase font-semibold text-muted-foreground mb-1">
          Recordings
        </div>
        <ScrollArea className="max-h-[28vh] border rounded">
          <ul className="divide-y">
            {recordings.length === 0 && !loadingList && (
              <li className="p-3 text-sm text-muted-foreground">
                No recordings stored for this project yet.
              </li>
            )}
            {recordings.map((r) => (
              <RecordingListItem
                key={`${r.source ?? "stored"}::${r.filePath}::${r.kind}::${r.methodName ?? ""}`}
                recording={r}
                isAnyRunActive={isAnyRunActive}
                onValidate={runOne}
              />
            ))}
          </ul>
        </ScrollArea>

        <Separator className="my-3" />

        <div className="text-xs uppercase font-semibold text-muted-foreground mb-1">
          Live runs
        </div>
        <ScrollArea className="flex-1 border rounded">
          {orderedRuns.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">
              No runs yet. Start one above.
            </div>
          )}
          <ul className="divide-y">
            {orderedRuns.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                onFixSelector={(ctx, tab) => {
                  setHealInitialTab(tab ?? "ai");
                  setHealTarget(ctx);
                }}
              />
            ))}
          </ul>
        </ScrollArea>
      </SheetContent>
      <FixSelectorDialog
        open={healTarget !== null}
        onOpenChange={(v) => {
          if (!v) setHealTarget(null);
        }}
        context={healTarget}
        initialTab={healInitialTab}
      />
    </Sheet>
  );
}
