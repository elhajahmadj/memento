import { useState } from "react";
import {
  getListSsoAccessRequestsQueryKey,
  useListSsoAccessRequests,
  useUpdateSsoAccessRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Inbox, RotateCcw, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { Label } from "@/shared/ui/label";
import { formatDateTime as formatTimestamp } from "@/shared/utils/format";

const GATE_LABEL: Record<string, string> = {
  no_memento_user: "Missing memento user claim",
  no_memento_access: "Org not authorized for memento",
  no_org: "No organization on account",
};

export function SsoAccessRequestsSection() {
  const [includeResolved, setIncludeResolved] = useState(false);
  const params = { includeResolved };
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useListSsoAccessRequests(params);
  const rows = data ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: getListSsoAccessRequestsQueryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: getListSsoAccessRequestsQueryKey({ includeResolved: true }),
    });
    void queryClient.invalidateQueries({
      queryKey: getListSsoAccessRequestsQueryKey({ includeResolved: false }),
    });
  };

  const updateMutation = useUpdateSsoAccessRequest({
    mutation: { onSettled: invalidate },
  });

  const setResolution = (
    id: string,
    resolution: "resolved" | "dismissed" | "pending",
  ) => {
    updateMutation.mutate({ id, data: { resolution } });
  };

  return (
    <div className="space-y-3" data-testid="section-sso-access-requests">
      <p className="text-sm text-muted-foreground">
        In-app "Request access" submissions from the SSO deny banner.
        Users on locked-down devices submit these instead of opening a
        mail client; follow up over email at the address they typed in,
        then mark the row handled so the queue stays focused on what's
        still outstanding.
      </p>

      <div className="flex items-center gap-2">
        <Switch
          id="toggle-sso-access-requests-include-resolved"
          checked={includeResolved}
          onCheckedChange={setIncludeResolved}
          data-testid="toggle-sso-access-requests-include-resolved"
        />
        <Label
          htmlFor="toggle-sso-access-requests-include-resolved"
          className="text-sm"
        >
          Include resolved
        </Label>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          data-testid="text-sso-access-requests-error"
        >
          Failed to load SSO access requests.
        </div>
      ) : rows.length === 0 ? (
        <div
          className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
          data-testid="text-sso-access-requests-empty"
        >
          {includeResolved
            ? "No access requests yet."
            : "No pending access requests."}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const resolved = row.resolvedAt !== null;
            return (
              <li
                key={row.id}
                className={
                  "rounded-md border border-border px-4 py-3 " +
                  (resolved ? "bg-muted/40" : "bg-card")
                }
                data-testid={`row-sso-access-request-${row.id}`}
                data-resolved={resolved ? "true" : "false"}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium">
                      <Inbox className="h-4 w-4 text-primary shrink-0" />
                      <a
                        href={`mailto:${row.email}`}
                        className="truncate underline underline-offset-2 hover:no-underline"
                        data-testid={`link-sso-access-request-email-${row.id}`}
                      >
                        {row.email}
                      </a>
                    </div>
                    {row.orgKey && (
                      <div className="mt-0.5 text-xs text-muted-foreground font-mono break-all">
                        org: {row.orgKey}
                      </div>
                    )}
                    {row.message && (
                      <p
                        className="mt-2 whitespace-pre-wrap text-sm text-foreground/90"
                        data-testid={`text-sso-access-request-message-${row.id}`}
                      >
                        {row.message}
                      </p>
                    )}
                    {resolved && (
                      <p
                        className="mt-2 text-xs text-muted-foreground"
                        data-testid={`text-sso-access-request-resolved-${row.id}`}
                      >
                        Resolved {formatTimestamp(row.resolvedAt!)}
                        {row.resolvedByEmail
                          ? ` by ${row.resolvedByEmail}`
                          : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0 text-right">
                    <span
                      className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                      data-testid={`badge-sso-access-request-gate-${row.id}`}
                    >
                      {GATE_LABEL[row.gate] ?? row.gate}
                    </span>
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid={`text-sso-access-request-time-${row.id}`}
                    >
                      {formatTimestamp(row.createdAt)}
                    </span>
                    {resolved ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={updateMutation.isPending}
                        onClick={() => setResolution(row.id, "pending")}
                        data-testid={`button-sso-access-request-reopen-${row.id}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                        Reopen
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={updateMutation.isPending}
                          onClick={() => setResolution(row.id, "resolved")}
                          data-testid={`button-sso-access-request-resolve-${row.id}`}
                        >
                          <Check className="h-3.5 w-3.5 mr-1" />
                          Mark resolved
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={updateMutation.isPending}
                          onClick={() => setResolution(row.id, "dismissed")}
                          data-testid={`button-sso-access-request-dismiss-${row.id}`}
                        >
                          <X className="h-3.5 w-3.5 mr-1" />
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
