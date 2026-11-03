import { useCallback, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getGetCurrentProjectQueryKey,
  getGetRecordingStatusQueryKey,
  getListAvailableProjectsQueryKey,
  getListProjectLifecycleRequestsQueryKey,
  useCancelProjectLifecycleRequest,
  useCloneProjectFromRepo,
  useCreateProject,
  useCreateProjectAccessRequest,
  useGetCurrentProject,
  useGetRecordingStatus,
  useListAvailableProjects,
  useListProjectLifecycleRequests,
  useLoadProject,
} from "@workspace/api-client-react";
import {
  extractMutationErrorMessage,
  isOpenBrowserActive,
  isPendingProjectResponse,
  pendingCreateRequestIdsByProject,
  visibleAvailableProjects,
} from "@/features/projects/domain";
import { markJmxAutoStart } from "@/features/workbench/presentation/hooks/jmx-auto-start";
import { usePrewarmBrowser } from "@/features/projects/presentation/hooks/use-prewarm-browser";

/**
 * State + data-fetching for the admin Projects home page.
 *
 * Keeps the page component a thin shell that only wires the returned
 * record into JSX. All filter/sort decisions live in
 * `features/projects/domain/projectListRules` and are unit-tested
 * independently of React.
 */
export function useAdminProjectsHome() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  useGetCurrentProject();

  const [newOpen, setNewOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const prewarm = usePrewarmBrowser();

  const { data: recordingStatus } = useGetRecordingStatus({
    query: {
      refetchInterval: 2500,
      queryKey: getGetRecordingStatusQueryKey(),
    },
  });
  const openBrowserActive = isOpenBrowserActive(recordingStatus);
  const aiDisabledReason = openBrowserActive
    ? "Close the open browser session first."
    : undefined;

  const {
    data: available,
    isLoading: loadingAvailable,
    refetch: refetchAvailable,
  } = useListAvailableProjects({ query: { queryKey: ["listAvailableProjects"] } });
  const visibleAvailable = visibleAvailableProjects(available);
  const hasProjects = visibleAvailable.length > 0;

  const create = useCreateProject({
    mutation: {
      onSuccess: async (data) => {
        if (isPendingProjectResponse(data)) {
          toast.success("Project submitted for admin approval");
          await qc.invalidateQueries({
            queryKey: getListProjectLifecycleRequestsQueryKey(),
          });
          await refetchAvailable();
          setNewOpen(false);
          return;
        }
        toast.success("Project scaffolded");
        await qc.invalidateQueries({ queryKey: getGetCurrentProjectQueryKey() });
        setNewOpen(false);
        // JMX projects auto-open the recording browser at the
        // project's target URL right after creation — mark the
        // project id so <JmxRecordingControls /> kicks off the
        // recording on mount. The marker is one-shot and lives in
        // memory only, so reloading or navigating back to the
        // workbench later does NOT re-trigger auto-start.
        if (
          data &&
          typeof data === "object" &&
          (data as { language?: unknown }).language === "jmx" &&
          typeof (data as { slnPath?: unknown }).slnPath === "string"
        ) {
          markJmxAutoStart(
            encodeURIComponent((data as { slnPath: string }).slnPath),
          );
        }
        navigate("/workbench");
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to create project"),
    },
  });

  const clone = useCloneProjectFromRepo({
    mutation: {
      onSuccess: async (project) => {
        setCloneError(null);
        toast.success(`Cloned ${project.solutionName}`);
        await qc.invalidateQueries({ queryKey: getGetCurrentProjectQueryKey() });
        await qc.invalidateQueries({ queryKey: getListAvailableProjectsQueryKey() });
        await refetchAvailable();
        setNewOpen(false);
        navigate("/workbench");
      },
      onError: (e: unknown) => {
        setCloneError(extractMutationErrorMessage(e, "Failed to clone repository"));
      },
    },
  });
  const clearCloneError = useCallback(() => setCloneError(null), []);

  const load = useLoadProject({
    mutation: {
      // Warm a recording browser as soon as Open is clicked so it is
      // ready by the time the workbench mounts.
      onMutate: () => prewarm(),
      onSuccess: async () => {
        toast.success("Project loaded");
        await qc.invalidateQueries({ queryKey: getGetCurrentProjectQueryKey() });
        navigate("/workbench");
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to load project"),
    },
  });

  const requestAccess = useCreateProjectAccessRequest({
    mutation: {
      onSuccess: async () => {
        toast.success("Access request submitted");
        await refetchAvailable();
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to request access"),
    },
  });

  const myLifecycle = useListProjectLifecycleRequests(
    { mine: true, status: "pending" },
    {
      query: {
        queryKey: getListProjectLifecycleRequestsQueryKey({
          mine: true,
          status: "pending",
        }),
      },
    },
  );
  const myPendingByProject = pendingCreateRequestIdsByProject(myLifecycle.data);

  const cancel = useCancelProjectLifecycleRequest({
    mutation: {
      onSuccess: async () => {
        toast.success("Request cancelled");
        await qc.invalidateQueries({
          queryKey: getListProjectLifecycleRequestsQueryKey(),
        });
        await refetchAvailable();
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to cancel"),
    },
  });

  return {
    newOpen,
    setNewOpen,
    aiOpen,
    setAiOpen,
    aiDisabledReason,
    loadingAvailable,
    visibleAvailable,
    hasProjects,
    create,
    clone,
    cloneError,
    clearCloneError,
    load,
    requestAccess,
    myPendingByProject,
    cancel,
  };
}
