import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  approveSubmission,
  getApproval,
  getApprovalDiff,
  getApprovalFileDiff,
  rejectSubmission,
} from "@workspace/api-client-react";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { APPROVALS_KEY } from "../format";
import { FileItem } from "./file-item";
import { DiffView } from "./diff-view";
import { ApprovalDecisionDialog } from "./approval-decision-dialog";
import { ApprovalDetailHeader } from "./approval-detail-header";

export function ApprovalDetail({
  id,
  onDecided,
}: {
  id: string;
  onDecided: () => void;
}) {
  const qc = useQueryClient();
  const meta = useQuery({
    queryKey: [APPROVALS_KEY, "one", id],
    queryFn: () => getApproval(id),
  });
  const diff = useQuery({
    queryKey: [APPROVALS_KEY, "diff", id],
    queryFn: () => getApprovalDiff(id),
  });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [excludedFiles, setExcludedFiles] = useState<Set<string>>(new Set());
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    setSelectedFile(null);
    setExcludedFiles(new Set());
    setAcknowledged(false);
  }, [id]);

  const fileDiff = useQuery({
    queryKey: [APPROVALS_KEY, "diff", id, selectedFile],
    queryFn: () => getApprovalFileDiff(id, selectedFile!),
    enabled: !!selectedFile,
  });

  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");

  const files = diff.data?.files ?? [];
  const filesToApply = useMemo(
    () => files.filter((f) => !excludedFiles.has(f.path)),
    [files, excludedFiles],
  );
  const conflictsAmongApplied = useMemo(
    () => filesToApply.filter((f) => f.mainChangedSinceSnapshot === true),
    [filesToApply],
  );
  const totalConflicts = useMemo(
    () => files.filter((f) => f.mainChangedSinceSnapshot === true).length,
    [files],
  );
  const isPending = meta.data?.status === "pending";
  const someExcluded = excludedFiles.size > 0;

  const approve = useMutation({
    mutationFn: (c: string) =>
      approveSubmission(id, {
        ...(c ? { comment: c } : {}),
        ...(someExcluded
          ? { selectedFiles: filesToApply.map((f) => f.path) }
          : {}),
        ...(conflictsAmongApplied.length > 0
          ? { acknowledgeConflicts: acknowledged }
          : {}),
      }),
    onSuccess: () => {
      toast.success(
        someExcluded
          ? `Approved & merged ${filesToApply.length} file(s) into main`
          : "Approved & merged into main",
      );
      void qc.invalidateQueries({ queryKey: [APPROVALS_KEY] });
      onDecided();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to approve"),
  });

  const reject = useMutation({
    mutationFn: (c: string) => rejectSubmission(id, c || undefined),
    onSuccess: () => {
      toast.success("Rejected");
      void qc.invalidateQueries({ queryKey: [APPROVALS_KEY] });
      onDecided();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to reject"),
  });

  if (meta.isLoading) {
    return (
      <div className="rounded-md border border-card-border bg-card p-10 shadow-card flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!meta.data) {
    return (
      <div className="rounded-md border border-card-border bg-card p-10 shadow-card text-center text-sm text-muted-foreground">
        Submission not found.
      </div>
    );
  }

  const approveBlocked =
    !!isPending &&
    (filesToApply.length === 0 || (conflictsAmongApplied.length > 0 && !acknowledged));

  function toggleExcluded(p: string) {
    setExcludedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  return (
    <div className="rounded-md border border-card-border bg-card shadow-card flex flex-col min-h-[24rem]">
      <ApprovalDetailHeader
        meta={meta.data}
        isPending={!!isPending}
        totalConflicts={totalConflicts}
        conflictsAmongApplied={conflictsAmongApplied.length}
        acknowledged={acknowledged}
        onAcknowledgeChange={setAcknowledged}
        filesToApply={filesToApply.length}
        totalFiles={files.length}
        someExcluded={someExcluded}
        approveBlocked={approveBlocked}
        onApproveClick={() => {
          setComment("");
          setConfirmAction("approve");
        }}
        onRejectClick={() => {
          setComment("");
          setConfirmAction("reject");
        }}
      />

      <div className="grid md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] flex-1 min-h-0">
        <div className="border-r border-card-border">
          {diff.isLoading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : files.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No file differences.</div>
          ) : (
            <ScrollArea className="max-h-[36rem]">
              <ul className="p-2 space-y-0.5" data-testid="diff-file-list">
                {files.map((f) => (
                  <FileItem
                    key={f.path}
                    file={f}
                    active={f.path === selectedFile}
                    selectable={!!isPending}
                    included={!excludedFiles.has(f.path)}
                    onToggle={() => toggleExcluded(f.path)}
                    onClick={() => setSelectedFile(f.path)}
                  />
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>
        <div className="min-w-0">
          {!selectedFile ? (
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
            <div className="p-8 text-sm text-muted-foreground">Failed to load diff.</div>
          )}
        </div>
      </div>

      <ApprovalDecisionDialog
        action={confirmAction}
        someExcluded={someExcluded}
        filesToApply={filesToApply.length}
        totalFiles={files.length}
        conflictsAmongApplied={conflictsAmongApplied.length}
        comment={comment}
        onCommentChange={setComment}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction === "approve") approve.mutate(comment);
          else if (confirmAction === "reject") reject.mutate(comment);
          setConfirmAction(null);
        }}
        pending={approve.isPending || reject.isPending}
      />
    </div>
  );
}
