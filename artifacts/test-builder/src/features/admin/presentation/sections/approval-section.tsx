import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listApprovals, type ApprovalStatus } from "@workspace/api-client-react";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { APPROVALS_KEY } from "@/features/approvals/presentation/format";
import { ApprovalList } from "@/features/approvals/presentation/components/approval-list";
import { ApprovalDetail } from "@/features/approvals/presentation/components/approval-detail";

export function ApprovalSection() {
  const [filter, setFilter] = useState<ApprovalStatus | "all">("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const queryStatus = filter === "all" ? undefined : filter;
  const list = useQuery({
    queryKey: [APPROVALS_KEY, "list", queryStatus ?? "all"],
    queryFn: () => listApprovals(queryStatus),
  });

  return (
    <section data-testid="section-approval">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Review submissions from project forks and decide whether to merge them
          into main.
        </p>
        <Tabs
          value={filter}
          onValueChange={(v) => {
            setFilter(v as ApprovalStatus | "all");
            setSelectedId(null);
          }}
        >
          <TabsList>
            <TabsTrigger value="pending" data-testid="tab-pending">Pending</TabsTrigger>
            <TabsTrigger value="approved" data-testid="tab-approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected" data-testid="tab-rejected">Rejected</TabsTrigger>
            <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <ApprovalList
          loading={list.isLoading}
          items={Array.isArray(list.data) ? list.data : []}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {selectedId ? (
          <ApprovalDetail
            key={selectedId}
            id={selectedId}
            onDecided={() => {
              setSelectedId(null);
              void list.refetch();
            }}
          />
        ) : (
          <div className="rounded-md border border-card-border bg-card p-10 shadow-card text-center text-sm text-muted-foreground">
            Select a submission on the left to see the per-file diff.
          </div>
        )}
      </div>
    </section>
  );
}
