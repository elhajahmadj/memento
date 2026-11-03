/**
 * <BranchDropdown /> — the Explorer panel's branch picker.
 *
 * Lives in the Explorer panel header next to the "Explorer" label.
 * Shows the currently checked-out local branch as the trigger, opens a
 * menu listing all local branches, and offers an inline "Create new
 * branch…" affordance at the bottom. All operations go through the
 * generated React Query hooks (`useListProjectBranches`,
 * `useCheckoutProjectBranch`, `useCreateProjectBranch`).
 *
 * The dropdown is hidden entirely when the project is not under Git
 * (the server reports `hasGitWorkingCopy: false`). Errors from the
 * server (invalid name, branch already exists, dirty working copy,
 * etc.) surface inline rather than as toasts so the user sees them
 * next to the input that produced them. Switching into a dirty working
 * copy pops a confirmation alert before sending `force: true`.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useListProjectBranches,
  useCheckoutProjectBranch,
  useCreateProjectBranch,
  getListProjectBranchesQueryKey,
  getGetProjectTreeQueryKey,
} from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/shared/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Check, ChevronDown, GitBranch, Loader2, Plus } from "lucide-react";

export function BranchDropdown({ projectName }: { projectName: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  const {
    data,
    isLoading,
    refetch,
  } = useListProjectBranches(projectName, {
    query: { queryKey: getListProjectBranchesQueryKey(projectName) },
  });

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({
        queryKey: getListProjectBranchesQueryKey(projectName),
      }),
      qc.invalidateQueries({ queryKey: getGetProjectTreeQueryKey() }),
    ]);
    await refetch();
  };

  const checkout = useCheckoutProjectBranch({
    mutation: {
      onError: (e: Error) => setInlineError(e.message ?? "Checkout failed"),
    },
  });
  const createBranch = useCreateProjectBranch({
    mutation: {
      onError: (e: Error) => setInlineError(e.message ?? "Create failed"),
    },
  });

  // Server reports the working copy isn't a git repo (or no git config
  // exists for this project) — hide the dropdown completely.
  if (!isLoading && data && !data.hasGitWorkingCopy) return null;
  // Initial fetch still in flight: render a slim placeholder so the
  // header doesn't reflow when the data arrives.
  if (isLoading || !data) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground/70"
        data-testid="branch-dropdown-loading"
      >
        <GitBranch className="h-3 w-3" />
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  }

  const current = data.current ?? "(detached)";

  const doCheckout = async (name: string, force: boolean) => {
    setInlineError(null);
    const result = await checkout.mutateAsync({
      projectName,
      data: { name, force },
    });
    if (!result.ok) {
      if (result.errorCode === "dirty_working_copy" && !force) {
        // Surface a confirmation dialog and remember the target so the
        // user can confirm-discard or cancel.
        setPendingSwitch(name);
        return;
      }
      setInlineError(result.message ?? "Checkout failed");
      return;
    }
    await refresh();
    setOpen(false);
    toast.success(`Switched to ${result.current ?? name}`);
  };

  const doCreate = async () => {
    setInlineError(null);
    const name = newName.trim();
    if (!name) {
      setInlineError("Enter a branch name.");
      return;
    }
    const result = await createBranch.mutateAsync({
      projectName,
      data: { name, checkout: true },
    });
    if (!result.ok) {
      setInlineError(result.message ?? "Failed to create branch");
      return;
    }
    await refresh();
    setNewName("");
    setCreating(false);
    setOpen(false);
    toast.success(`Created and switched to ${result.current ?? name}`);
  };

  return (
    <>
      <DropdownMenu
        // `modal={false}` disables Radix's body-level pointer-events
        // lock + scroll-lock. With the default `modal` mode, closing the
        // menu programmatically (e.g. from `doCreate`/`doCheckout` after
        // an awaited mutation) can leave `pointer-events: none` on
        // `<body>` for a frame or two while the close transition
        // unmounts the content. The very next click on the trigger then
        // lands on a non-interactive body and is swallowed, so users
        // (and the e2e spec) see a dead first click. A dropdown menu in
        // a panel header isn't a true modal anyway — non-modal matches
        // the semantics and makes reopen-after-close instant.
        modal={false}
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setCreating(false);
            setNewName("");
            setInlineError(null);
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 gap-1 text-xs font-mono normal-case tracking-normal text-foreground hover:bg-sidebar-accent"
            data-testid="button-branch-dropdown"
            title={`Current branch: ${current}`}
          >
            <GitBranch className="h-3 w-3" />
            <span className="max-w-[140px] truncate">{current}</span>
            <ChevronDown className="h-3 w-3 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-64"
          data-testid="branch-dropdown-menu"
        >
          <DropdownMenuLabel className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            Local branches
          </DropdownMenuLabel>
          {data.branches.length === 0 ? (
            <div
              className="px-2 py-1.5 text-xs text-muted-foreground"
              data-testid="branch-dropdown-empty"
            >
              No local branches yet.
            </div>
          ) : (
            data.branches.map((b) => {
              const isCurrent = b === data.current;
              return (
                <DropdownMenuItem
                  key={b}
                  onSelect={(e) => {
                    e.preventDefault();
                    if (!isCurrent) void doCheckout(b, false);
                  }}
                  data-testid={`branch-dropdown-item-${b}`}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="truncate font-mono">{b}</span>
                  {isCurrent ? (
                    <Check
                      className="h-3.5 w-3.5 text-primary"
                      data-testid={`branch-dropdown-current-${b}`}
                    />
                  ) : null}
                </DropdownMenuItem>
              );
            })
          )}
          <DropdownMenuSeparator />
          {creating ? (
            <div className="p-2 space-y-2" data-testid="branch-dropdown-create">
              <Input
                autoFocus
                value={newName}
                placeholder="new-branch-name"
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (inlineError) setInlineError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void doCreate();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setCreating(false);
                    setNewName("");
                    setInlineError(null);
                  }
                }}
                className="h-7 text-xs font-mono"
                data-testid="input-branch-name"
              />
              {inlineError ? (
                <div
                  className="text-[11px] text-destructive"
                  data-testid="branch-dropdown-error"
                >
                  {inlineError}
                </div>
              ) : null}
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                    setInlineError(null);
                  }}
                  data-testid="button-cancel-create-branch"
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={createBranch.isPending}
                  onClick={() => void doCreate()}
                  data-testid="button-submit-create-branch"
                >
                  {createBranch.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Create"
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setCreating(true);
                  setInlineError(null);
                }}
                className="text-xs gap-2"
                data-testid="button-open-create-branch"
              >
                <Plus className="h-3.5 w-3.5" />
                Create new branch…
              </DropdownMenuItem>
              {inlineError ? (
                <div
                  className="px-2 py-1 text-[11px] text-destructive"
                  data-testid="branch-dropdown-error"
                >
                  {inlineError}
                </div>
              ) : null}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={!!pendingSwitch}
        onOpenChange={(o) => {
          if (!o) setPendingSwitch(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-dirty-checkout">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard uncommitted changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The working copy has uncommitted changes that will be lost if
              you switch to{" "}
              <span className="font-mono">{pendingSwitch}</span>. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-dirty-checkout">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-dirty-checkout"
              onClick={() => {
                const target = pendingSwitch;
                setPendingSwitch(null);
                if (target) void doCheckout(target, true);
              }}
            >
              Discard and switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
