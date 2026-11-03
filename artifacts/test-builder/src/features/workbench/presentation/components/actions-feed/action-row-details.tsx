import type { RecordedActionMsg } from "@/features/workbench/domain/types";

/**
 * Per-action-type detail lines rendered under the row header (the
 * "↳ …" lines). Returns null for action shapes that have no extra
 * detail to display. Pure presentation — no state, no events.
 */
export function ActionRowDetails({ action: a }: { action: RecordedActionMsg }) {
  return (
    <>
      {a.selector && (
        <div className="mt-1 text-muted-foreground truncate">{a.selector}</div>
      )}
      {a.value && (
        <div className="mt-0.5 text-muted-foreground truncate">↳ {a.value}</div>
      )}
      {a.url && (
        <div className="mt-0.5 text-muted-foreground truncate">{a.url}</div>
      )}
      {a.type === "assert" && a.assertKind === "element-has-text" && (
        <div className="mt-0.5 text-muted-foreground truncate">
          ↳ has text {JSON.stringify(a.assertText ?? "")}
        </div>
      )}
      {a.type === "assert" && a.assertKind === "url-contains" && (
        <div className="mt-0.5 text-muted-foreground truncate">
          url contains {JSON.stringify(a.assertUrl ?? "")}
        </div>
      )}
      {a.type === "assert" && a.assertKind === "url-equals" && (
        <div className="mt-0.5 text-muted-foreground truncate">
          url equals {JSON.stringify(a.assertUrl ?? "")}
        </div>
      )}
      {a.type === "assert" && a.assertKind === "element-visible" && (
        <div className="mt-0.5 text-muted-foreground truncate">↳ is visible</div>
      )}
      {a.type === "assert" && a.assertKind === "element-hidden" && (
        <div className="mt-0.5 text-muted-foreground truncate">↳ is hidden</div>
      )}
      {a.type === "assert" && a.assertKind === "element-count-equals" && (
        <div className="mt-0.5 text-muted-foreground truncate">
          ↳ count = {a.assertCount ?? 0}
        </div>
      )}
      {a.type === "assert" && a.assertKind === "attribute-equals" && (
        <div className="mt-0.5 text-muted-foreground truncate">
          ↳ {a.assertAttribute ?? "attr"} ={" "}
          {JSON.stringify(a.assertAttrValue ?? "")}
        </div>
      )}
      {a.type === "assert" && a.assertKind === "value-equals" && (
        <div className="mt-0.5 text-muted-foreground truncate">
          ↳ value = {JSON.stringify(a.assertValue ?? "")}
        </div>
      )}
      {a.type === "assert" && a.assertKind === "response-status" && (
        <div className="mt-0.5 text-muted-foreground truncate">
          response status {a.assertStatusCode ?? 200}
        </div>
      )}
      {a.type === "wait" && a.waitKind === "selector" && (
        <div className="mt-0.5 text-muted-foreground truncate">
          ↳ wait for selector{" "}
          <span className="font-mono">{a.waitSelector ?? ""}</span>
        </div>
      )}
      {a.type === "wait" && a.waitKind === "networkidle" && (
        <div className="mt-0.5 text-muted-foreground truncate">
          ↳ wait for network idle
        </div>
      )}
      {a.type === "wait" && a.waitKind === "timeout" && (
        <div className="mt-0.5 text-muted-foreground truncate">
          ↳ wait {a.waitMs ?? 0}ms
        </div>
      )}
    </>
  );
}
