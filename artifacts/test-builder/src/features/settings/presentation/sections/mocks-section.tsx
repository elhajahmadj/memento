import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  useGetCurrentProject,
  useListRouteMocks,
  useCreateRouteMock,
  useUpdateRouteMock,
  useDeleteRouteMock,
  getListRouteMocksQueryKey,
  type RouteMock,
  type RouteMockMethod,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { validateMockDraft, type MockDraft } from "../../domain/mock-rules";
import { MockEditDialog } from "./mock-edit-dialog";

/**
 * Settings → Mocks section. Lists the network-mock rules attached to
 * the active project's recording. The recorder + replay services read
 * these rows and install matching `page.route()` interceptions before
 * navigation, so generated tests run deterministically against canned
 * responses without relying on the live backend.
 */
export function MocksSection() {
  const qc = useQueryClient();
  const { data: project } = useGetCurrentProject();
  const projectName = project?.project?.solutionName ?? "";
  const enabled = projectName.length > 0;

  const { data, isLoading } = useListRouteMocks(
    { projectName },
    {
      query: {
        enabled,
        queryKey: getListRouteMocksQueryKey({ projectName }),
      },
    },
  );

  const create = useCreateRouteMock({
    mutation: {
      onSuccess: async () => {
        toast.success("Mock added");
        await qc.invalidateQueries({
          queryKey: getListRouteMocksQueryKey({ projectName }),
        });
        setEditTarget(null);
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to add mock"),
    },
  });
  const update = useUpdateRouteMock({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({
          queryKey: getListRouteMocksQueryKey({ projectName }),
        });
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to update mock"),
    },
  });
  const remove = useDeleteRouteMock({
    mutation: {
      onSuccess: async () => {
        toast.success("Mock removed");
        await qc.invalidateQueries({
          queryKey: getListRouteMocksQueryKey({ projectName }),
        });
      },
      onError: (e: Error) => toast.error(e.message ?? "Failed to remove mock"),
    },
  });

  const [editTarget, setEditTarget] = useState<MockDraft | null>(null);

  if (!enabled) {
    return (
      <div
        className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
        data-testid="mocks-no-project"
      >
        Open a project to manage its network mocks.
      </div>
    );
  }

  const mocks = data?.mocks ?? [];

  const startNew = () =>
    setEditTarget({
      name: "",
      method: "GET",
      urlPattern: "",
      status: "200",
      bodyJson: "",
      enabled: true,
    });

  const startEdit = (m: RouteMock) =>
    setEditTarget({
      id: m.id,
      name: m.name,
      method: m.method as RouteMockMethod,
      urlPattern: m.urlPattern,
      status: String(m.status),
      bodyJson: m.bodyJson == null ? "" : JSON.stringify(m.bodyJson, null, 2),
      enabled: m.enabled,
    });

  const save = async () => {
    if (!editTarget) return;
    const result = validateMockDraft(editTarget);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const v = result.value;
    if (editTarget.id) {
      await update.mutateAsync({
        id: editTarget.id,
        data: {
          name: v.name,
          method: v.method,
          urlPattern: v.urlPattern,
          status: v.status,
          bodyJson: v.bodyJson as never,
          enabled: v.enabled,
        },
      });
      setEditTarget(null);
    } else {
      await create.mutateAsync({
        data: {
          projectName,
          name: v.name,
          method: v.method,
          urlPattern: v.urlPattern,
          status: v.status,
          bodyJson: v.bodyJson as never,
          enabled: v.enabled,
        },
      });
    }
  };

  return (
    <section data-testid="section-mocks">
      <div className="rounded-md border border-border bg-card p-4 shadow-card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-medium">Network mocks for {projectName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each enabled rule installs a Playwright `page.route()`
              interception during recording and replay.
            </p>
          </div>
          <Button size="sm" onClick={startNew} data-testid="button-add-mock">
            <Plus className="h-4 w-4 mr-1" /> Add mock
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : mocks.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-no-mocks"
          >
            No mocks yet. Click <em>Add mock</em> to create one.
          </p>
        ) : (
          <ul className="divide-y border rounded-md">
            {mocks.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 px-3 py-2"
                data-testid={`row-mock-${m.id}`}
              >
                <Switch
                  checked={m.enabled}
                  onCheckedChange={(checked) =>
                    update.mutate({
                      id: m.id,
                      data: { enabled: checked },
                    })
                  }
                  data-testid={`switch-mock-${m.id}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{m.name}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {m.method} {m.urlPattern} → {m.status}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => startEdit(m)}
                  data-testid={`button-edit-mock-${m.id}`}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove.mutate({ id: m.id })}
                  data-testid={`button-delete-mock-${m.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <MockEditDialog
        draft={editTarget}
        onChange={setEditTarget}
        onClose={() => setEditTarget(null)}
        onSave={save}
        saving={create.isPending || update.isPending}
      />
    </section>
  );
}
