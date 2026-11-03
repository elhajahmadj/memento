import { useState } from "react";
import {
  getListSsoDenialsQueryKey,
  useListSsoDenials,
  useUpdateSsoDenial,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldX } from "lucide-react";
import { formatDateTime as formatTimestamp } from "@/shared/utils/format";

const GATE_LABEL: Record<string, string> = {
  no_memento_user: "Missing memento user claim",
  no_memento_access: "Org not authorized for memento",
  no_org: "No organization on account",
};

export function SsoDenialsSection() {
  const [showHandled, setShowHandled] = useState(false);
  const queryClient = useQueryClient();
  const params = showHandled ? { includeHandled: true } : undefined;
  const { data, isLoading, error } = useListSsoDenials(params);
  const rows = data ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({
      // Invalidate both the open and "show handled" caches so the row
      // moves between them immediately.
      predicate: (q) => {
        const k = q.queryKey;
        return Array.isArray(k) && k[0] === "/api/sso-denials";
      },
    });
  };

  const updateMutation = useUpdateSsoDenial({
    mutation: {
      onSuccess: invalidate,
    },
  });
  // Reference the query-key helper so tree-shaking keeps it linked; useful
  // for tests that want to await the same cache key.
  void getListSsoDenialsQueryKey;

  return (
    <div className="space-y-3" data-testid="section-sso-denials">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-prose">
          Recent SSO sign-ins rejected by the identity provider claim gates. Use this
          to confirm a user actually attempted to sign in and which gate
          blocked them, so you can grant the missing access in your identity provider.
          Rows older than 30 days are pruned automatically. Once you've
          handled a row, dismiss it so the queue only shows what's still
          actionable.
        </p>
        <label
          className="inline-flex items-center gap-2 text-sm text-muted-foreground shrink-0"
          data-testid="label-sso-denials-show-handled"
        >
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={showHandled}
            onChange={(e) => setShowHandled(e.target.checked)}
            data-testid="checkbox-sso-denials-show-handled"
          />
          Show handled
        </label>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          data-testid="text-sso-denials-error"
        >
          Failed to load SSO denials.
        </div>
      ) : rows.length === 0 ? (
        <div
          className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
          data-testid="text-sso-denials-empty"
        >
          {showHandled
            ? "No SSO denials in the last 30 days."
            : "No open SSO denials. Toggle Show handled to see ones you've already dismissed."}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const isHandled = row.handledAt !== null;
            return (
              <li
                key={row.id}
                className={
                  "rounded-md border border-border bg-card px-4 py-3 " +
                  (isHandled ? "opacity-60" : "")
                }
                data-testid={`row-sso-denial-${row.id}`}
                data-handled={isHandled ? "true" : "false"}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium">
                      <ShieldX className="h-4 w-4 text-destructive shrink-0" />
                      <span
                        className="truncate"
                        data-testid={`text-sso-denial-identity-${row.id}`}
                      >
                        {row.email ?? row.subject}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground font-mono break-all">
                      sub: {row.subject}
                      {row.orgKey ? <> · org: {row.orgKey}</> : null}
                    </div>
                    {isHandled && (
                      <div
                        className="mt-1 text-xs text-muted-foreground"
                        data-testid={`text-sso-denial-handled-${row.id}`}
                      >
                        Handled
                        {row.handledByUsername
                          ? ` by ${row.handledByUsername}`
                          : ""}
                        {row.handledAt
                          ? ` · ${formatTimestamp(row.handledAt)}`
                          : ""}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0 text-right">
                    <span
                      className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                      data-testid={`badge-sso-denial-gate-${row.id}`}
                    >
                      {GATE_LABEL[row.gate] ?? row.gate}
                    </span>
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid={`text-sso-denial-time-${row.id}`}
                    >
                      {formatTimestamp(row.createdAt)}
                    </span>
                    {isHandled ? (
                      <button
                        type="button"
                        className="mt-1 inline-flex items-center rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                        disabled={updateMutation.isPending}
                        onClick={() =>
                          updateMutation.mutate({
                            id: row.id,
                            data: { handled: false },
                          })
                        }
                        data-testid={`button-sso-denial-reopen-${row.id}`}
                      >
                        Reopen
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="mt-1 inline-flex items-center rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                        disabled={updateMutation.isPending}
                        onClick={() =>
                          updateMutation.mutate({
                            id: row.id,
                            data: { handled: true },
                          })
                        }
                        data-testid={`button-sso-denial-dismiss-${row.id}`}
                      >
                        Dismiss
                      </button>
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
