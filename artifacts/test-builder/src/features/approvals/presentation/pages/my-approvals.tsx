import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  Clock,
  FileEdit,
  FileMinus2,
  FilePlus2,
  GitFork,
  Loader2,
  XCircle,
} from "lucide-react";
import {
  getApprovalDiff,
  getApprovalFileDiff,
  listMyApprovals,
  type ApprovalDto,
  type ApprovalFileDiff,
  type ApprovalFileSummary,
  type ApprovalStatus,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { PageShell } from "@/shared/ui/shell/page-shell";
import { useIsAnyAdmin } from "@/features/auth/presentation/role";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { formatDateTime as formatDate } from "@/shared/utils/format";

const KEY = "myApprovalsHistory";

function statusLabel(s: ApprovalStatus): { text: string; cls: string; Icon: typeof Clock } {
  if (s === "pending")
    return {
      text: "Pending",
      cls: "bg-amber-500/15 text-amber-400 border-amber-500/30",
      Icon: Clock,
    };
  if (s === "approved")
    return {
      text: "Approved",
      cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      Icon: CheckCircle2,
    };
  return {
    text: "Rejected",
    cls: "bg-destructive/15 text-destructive border-destructive/30",
    Icon: XCircle,
  };
}

export function MyApprovals() {
  const isAdmin = useIsAnyAdmin();
  const [, navigate] = useLocation();
  const redirected = useRef(false);

  // Admin users have their own approval queue at /admin/approval; this page
  // is built for the limited "submitter" experience.
  useEffect(() => {
    if (isAdmin && !redirected.current) {
      redirected.current = true;
      navigate("/admin/approval", { replace: true });
    }
  }, [isAdmin, navigate]);

  const { data, isLoading } = useQuery({
    queryKey: [KEY, "list"],
    queryFn: () => listMyApprovals(),
    enabled: !isAdmin,
  });

  const [diffFor, setDiffFor] = useState<ApprovalDto | null>(null);

  if (isAdmin) return null;

  const items: ApprovalDto[] = Array.isArray(data) ? data : [];

  return (
    <PageShell
      contentClassName="max-w-4xl"
      backTestId="button-my-approvals-back"
      backLabel="Back to projects"
    >
      <h1 className="text-3xl font-semibold mb-2">My submissions</h1>
      <p className="text-muted-foreground mb-8">
        Every change you've sent for review, with the SDET's decision and
        comment.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div
          className="text-center py-16 text-sm text-muted-foreground border border-card-border rounded-md bg-card"
          data-testid="my-approvals-empty"
        >
          You haven't submitted any changes for review yet.
        </div>
      ) : (
        <ul className="space-y-3" data-testid="my-approvals-list">
          {items.map((a) => (
            <SubmissionCard
              key={a.id}
              approval={a}
              onViewDiff={() => setDiffFor(a)}
            />
          ))}
        </ul>
      )}

      <Dialog open={diffFor !== null} onOpenChange={(o) => !o && setDiffFor(null)}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitFork className="h-4 w-4 text-muted-foreground" />
              {diffFor?.projectName} · diff
            </DialogTitle>
          </DialogHeader>
          {diffFor && <DiffPanel id={diffFor.id} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function SubmissionCard({
  approval,
  onViewDiff,
}: {
  approval: ApprovalDto;
  onViewDiff: () => void;
}) {
  const tag = statusLabel(approval.status);
  const Icon = tag.Icon;
  return (
    <li>
      <div
        className="rounded-md border border-card-border bg-card p-5 shadow-card"
        data-testid={`my-approval-row-${approval.id}`}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="font-medium flex items-center gap-2">
              <GitFork className="h-4 w-4 text-muted-foreground" />
              {approval.projectName}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Submitted {formatDate(approval.submittedAt)}
              {approval.decidedAt
                ? ` · Decided ${formatDate(approval.decidedAt)}`
                : ""}
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1 text-[11px] uppercase tracking-wide px-2 py-1 rounded-full border ${tag.cls}`}
            data-testid={`my-approval-status-${approval.id}`}
          >
            <Icon className="h-3 w-3" /> {tag.text}
          </span>
        </div>
        {approval.comment && (
          <div
            className="mt-3 rounded-md border border-border bg-background/50 p-3 text-sm"
            data-testid={`my-approval-comment-${approval.id}`}
          >
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              SDET comment
            </div>
            <div className="whitespace-pre-wrap">{approval.comment}</div>
          </div>
        )}
        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={onViewDiff}
            data-testid={`button-view-diff-${approval.id}`}
          >
            View diff
          </Button>
        </div>
      </div>
    </li>
  );
}

function DiffPanel({ id }: { id: string }) {
  const diff = useQuery({
    queryKey: [KEY, "diff", id],
    queryFn: () => getApprovalDiff(id),
  });
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    setSelected(null);
  }, [id]);
  const fileDiff = useQuery({
    queryKey: [KEY, "diff", id, selected],
    queryFn: () => getApprovalFileDiff(id, selected!),
    enabled: !!selected,
  });

  useEffect(() => {
    if (diff.error) toast.error("Failed to load diff");
  }, [diff.error]);

  const files = diff.data?.files ?? [];

  return (
    <div className="grid md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] flex-1 min-h-0 border border-card-border rounded-md overflow-hidden">
      <div className="border-r border-card-border min-h-[20rem]">
        {diff.isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : files.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No file differences.
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <ul className="p-2" data-testid="my-diff-file-list">
              {files.map((f) => (
                <FileItem
                  key={f.path}
                  file={f}
                  active={f.path === selected}
                  onClick={() => setSelected(f.path)}
                />
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>
      <div className="min-w-0">
        {!selected ? (
          <div className="p-8 text-sm text-muted-foreground text-center">
            Pick a file on the left to see its diff.
          </div>
        ) : fileDiff.isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : fileDiff.data ? (
          <DiffView detail={fileDiff.data} />
        ) : (
          <div className="p-8 text-sm text-muted-foreground">
            Failed to load diff.
          </div>
        )}
      </div>
    </div>
  );
}

function FileItem({
  file,
  active,
  onClick,
}: {
  file: ApprovalFileSummary;
  active: boolean;
  onClick: () => void;
}) {
  const Icon =
    file.kind === "added"
      ? FilePlus2
      : file.kind === "deleted"
        ? FileMinus2
        : FileEdit;
  const colorCls =
    file.kind === "added"
      ? "text-green-500"
      : file.kind === "deleted"
        ? "text-red-500"
        : "text-yellow-500";
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        data-testid={`my-diff-file-${file.path}`}
        className={`w-full text-left px-2 py-2 rounded-sm flex items-center gap-2 text-sm hover-elevate ${
          active ? "bg-primary/10" : ""
        }`}
      >
        <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${colorCls}`} />
        <span className="font-mono text-xs truncate flex-1">{file.path}</span>
        {!file.binary && (
          <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
            <span className="text-green-500">+{file.additions}</span>{" "}
            <span className="text-red-500">-{file.deletions}</span>
          </span>
        )}
        {file.binary && (
          <span className="text-[10px] text-muted-foreground">binary</span>
        )}
      </button>
    </li>
  );
}

function DiffView({ detail }: { detail: ApprovalFileDiff }) {
  if (detail.binary) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Binary file — diff not shown.
      </div>
    );
  }
  return (
    <ScrollArea className="max-h-[60vh]" data-testid="my-diff-view">
      <pre className="text-xs font-mono p-3 leading-5 whitespace-pre">
        {detail.lines.map((l, i) => {
          const sign = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
          const cls =
            l.type === "add"
              ? "bg-green-500/10 text-green-300"
              : l.type === "del"
                ? "bg-red-500/10 text-red-300"
                : "text-muted-foreground";
          return (
            <div key={i} className={`px-2 ${cls}`}>
              <span className="select-none mr-2">{sign}</span>
              {l.text || " "}
            </div>
          );
        })}
      </pre>
    </ScrollArea>
  );
}
