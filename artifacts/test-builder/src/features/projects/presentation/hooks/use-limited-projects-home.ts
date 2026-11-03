import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getGetCurrentProjectQueryKey,
  getListAvailableProjectsQueryKey,
  getListProjectLifecycleRequestsQueryKey,
  listAvailableForkProjects,
  listMyApprovals,
  requestFork as requestForkApi,
  submitForkForApproval,
  useCancelProjectLifecycleRequest,
  useCreateProject,
  useListAvailableProjects,
  useListProjectLifecycleRequests,
  useLoadProject,
  type ApprovalDto,
  type ForkAvailableProject,
} from "@workspace/api-client-react";
import { useForkApprovalToasts } from "./use-fork-approval-toasts";
import { usePrewarmBrowser } from "./use-prewarm-browser";
import { markJmxAutoStart } from "@/features/workbench/presentation/hooks/jmx-auto-start";
import {
  approvedDirectProjects,
  groupApprovalsByProject,
  isPendingProjectResponse,
  latestApprovalByProject,
  pendingCreateRequests,
} from "@/features/projects/domain";

/**
 * State + data-fetching for the limited Projects home page. Mirrors
 * `useAdminProjectsHome` but for the fork-based workflow available to
 * non-admin users.
 */
export function useLimitedProjectsHome() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const prewarm = usePrewarmBrowser();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["forks", "available-projects"],
    queryFn: () => listAvailableForkProjects(),
  });
  const { data: approvals } = useQuery<ApprovalDto[]>({
    queryKey: ["myApprovals"],
    queryFn: () => listMyApprovals(),
    refetchInterval: 5000,
  });

  const byProject = useMemo(() => groupApprovalsByProject(approvals), [approvals]);
  const latestByProject = useMemo(
    () => latestApprovalByProject(byProject),
    [byProject],
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (project: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      return next;
    });
  };

  useForkApprovalToasts(approvals);

  const load = useLoadProject({
    mutation: {
      // Warm a recording browser as soon as Open is clicked.
      onMutate: () => prewarm(),
      onSuccess: async () => {
        toast.success("Fork loaded");
        await qc.invalidateQueries({ queryKey: getGetCurrentProjectQueryKey() });
        navigate("/workbench");
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to load fork"),
    },
  });
  const requestMutation = useMutation({
    mutationFn: (projectName: string) => requestForkApi(projectName),
    onSuccess: () => {
      toast.success("Fork request submitted");
      void refetch();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to request fork"),
  });
  const [submitTarget, setSubmitTarget] = useState<{ forkId: string; projectName: string } | null>(null);
  const [submitComment, setSubmitComment] = useState("");
  const submitMutation = useMutation({
    mutationFn: (args: { forkId: string; comment: string }) =>
      submitForkForApproval(args.forkId, args.comment),
    onSuccess: () => {
      toast.success("Submitted for admin approval");
      setSubmitTarget(null);
      setSubmitComment("");
      void refetch();
    },
    onError: (e: Error) =>
      toast.error(e.message ?? "Failed to submit for approval"),
  });

  const items: ForkAvailableProject[] = Array.isArray(data) ? data : [];

  const [newOpen, setNewOpen] = useState(false);
  const create = useCreateProject({
    mutation: {
      onSuccess: async (resp) => {
        setNewOpen(false);
        if (isPendingProjectResponse(resp)) {
          toast.success("Project submitted for admin approval");
          await qc.invalidateQueries({
            queryKey: getListProjectLifecycleRequestsQueryKey(),
          });
          return;
        }
        toast.success("Project scaffolded");
        await qc.invalidateQueries({ queryKey: getGetCurrentProjectQueryKey() });
        // Mirror the JMX auto-start marker from the admin variant so
        // a fresh JMX project opens its recording browser on the
        // workbench without an extra click.
        if (
          resp &&
          typeof resp === "object" &&
          (resp as { language?: unknown }).language === "jmx" &&
          typeof (resp as { slnPath?: unknown }).slnPath === "string"
        ) {
          markJmxAutoStart(
            encodeURIComponent((resp as { slnPath: string }).slnPath),
          );
        }
        navigate("/workbench");
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to request project"),
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
  const myPending = pendingCreateRequests(myLifecycle.data);
  const availableQ = useListAvailableProjects({
    query: { queryKey: getListAvailableProjectsQueryKey() },
  });
  const approvedDirect = approvedDirectProjects(availableQ.data);
  const cancel = useCancelProjectLifecycleRequest({
    mutation: {
      onSuccess: async () => {
        toast.success("Request cancelled");
        await qc.invalidateQueries({
          queryKey: getListProjectLifecycleRequestsQueryKey(),
        });
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to cancel"),
    },
  });

  const warnedRef = useRef(false);
  useEffect(() => {
    if (data !== undefined && !Array.isArray(data) && !warnedRef.current) {
      warnedRef.current = true;
      toast.error("Could not load available projects.");
    }
  }, [data]);

  return {
    isLoading,
    items,
    byProject,
    latestByProject,
    expanded,
    toggleExpanded,
    load,
    requestMutation,
    submitTarget,
    setSubmitTarget,
    submitComment,
    setSubmitComment,
    submitMutation,
    newOpen,
    setNewOpen,
    create,
    myPending,
    approvedDirect,
    cancel,
  };
}
