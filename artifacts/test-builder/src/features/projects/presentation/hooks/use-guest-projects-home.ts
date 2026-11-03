import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getGetCurrentProjectQueryKey,
  getListAvailableProjectsQueryKey,
  useCreateProject,
  useListAvailableProjects,
  useLoadProject,
  type AvailableProject,
} from "@workspace/api-client-react";
import { markJmxAutoStart } from "@/features/workbench/presentation/hooks/jmx-auto-start";
import { usePrewarmBrowser } from "@/features/projects/presentation/hooks/use-prewarm-browser";

/**
 * State + data-fetching for the guest Projects home.
 *
 * Deliberately much thinner than `useLimitedProjectsHome`: guests have
 * no forks, no approvals, and no lifecycle requests, and every one of
 * those endpoints is closed to them server-side. Reusing the limited
 * hook would fire four requests that can only 403.
 *
 * `GET /projects/available` is org-scoped by the server's `guest`
 * ScopePolicy, so it returns the guest's single project (or nothing),
 * which is also how we know whether they have already used their one
 * allowance.
 */
export function useGuestProjectsHome() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const prewarm = usePrewarmBrowser();

  const { data, isLoading } = useListAvailableProjects();
  const projects: AvailableProject[] = Array.isArray(data) ? data : [];
  /** Guests get exactly one; the server enforces it, this drives the UI. */
  const project = projects[0] ?? null;
  const hasProject = project !== null;

  const load = useLoadProject({
    mutation: {
      // Warm a recording browser as soon as Open is clicked.
      onMutate: () => prewarm(),
      onSuccess: async () => {
        await qc.invalidateQueries({
          queryKey: getGetCurrentProjectQueryKey(),
        });
        navigate("/workbench");
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to open project"),
    },
  });

  const create = useCreateProject({
    mutation: {
      onSuccess: async (resp) => {
        setNewOpen(false);
        toast.success("Project scaffolded");
        await qc.invalidateQueries({
          queryKey: getGetCurrentProjectQueryKey(),
        });
        await qc.invalidateQueries({
          queryKey: getListAvailableProjectsQueryKey(),
        });
        // Mirror the admin/limited variants: a fresh JMX project opens
        // its recording browser on the workbench without an extra click.
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
      // The server returns 409 with a readable message for both the
      // one-project limit and a taken solution name (the latter
      // including a suggested free name), so surface it as-is rather
      // than replacing it with a generic string. Keep the dialog open
      // on failure so the user can edit the name and retry.
      onError: (e: Error) =>
        toast.error(e.message || "Failed to create project"),
    },
  });

  return {
    isLoading,
    project,
    hasProject,
    newOpen,
    setNewOpen,
    create,
    load,
  };
}
