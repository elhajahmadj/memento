import { toast } from "sonner";
import {
  ArrowUp,
  ArrowDown,
  ChevronsDown,
  Copy,
  CornerDownRight,
  Pencil,
  Trash2,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import type { RecordedActionMsg } from "@/features/workbench/domain/types";
import { isEditableAction } from "./helpers";
import { ActionRowDetails } from "./action-row-details";

/**
 * One row in the actions feed: checkbox + type badge + suggested
 * method name + rename / move-up / move-down / duplicate / insert-
 * before / edit-value / delete buttons, followed by the per-type
 * detail lines. All mutations go out as `recorder:request-*` window
 * events; the only callbacks are for state owned by the container
 * (selection, focus, edit-target).
 */
export function ActionRow({
  action: a,
  fallbackKey: i,
  visibleIndices,
  selected,
  isHovered,
  isFocused,
  onRegisterRef,
  onCheckboxClick,
  onDeleteFromHere,
  onFocus,
  onEditValue,
}: {
  action: RecordedActionMsg;
  fallbackKey: number;
  visibleIndices: number[];
  selected: Set<number>;
  isHovered: boolean;
  isFocused: boolean;
  onRegisterRef: (index: number, el: HTMLDivElement | null) => void;
  onCheckboxClick: (e: React.MouseEvent<HTMLInputElement>, index: number) => void;
  onDeleteFromHere: (
    e: React.MouseEvent<HTMLButtonElement>,
    index: number,
  ) => void;
  onFocus: (index: number) => void;
  onEditValue: (action: RecordedActionMsg) => void;
}) {
  return (
    <div
      ref={(el) => {
        if (typeof a.index !== "number") return;
        onRegisterRef(a.index, el);
      }}
      onMouseEnter={() => {
        if (typeof a.index === "number") {
          window.dispatchEvent(
            new CustomEvent("recorder:hover-action", {
              detail: { index: a.index },
            }),
          );
        }
      }}
      onMouseLeave={() => {
        if (typeof a.index === "number") {
          window.dispatchEvent(
            new CustomEvent("recorder:hover-action", {
              detail: { index: null },
            }),
          );
        }
      }}
      onClick={(e) => {
        if (typeof a.index !== "number") return;
        e.stopPropagation();
        onFocus(a.index);
      }}
      data-testid={`action-feed-item-${a.index ?? i}`}
      className={`text-xs font-mono px-2 py-1.5 rounded-sm bg-card border transition-colors cursor-pointer ${
        isHovered
          ? "border-primary ring-1 ring-primary/40 bg-primary/10"
          : isFocused
            ? "border-primary ring-2 ring-primary/60 bg-primary/5"
            : "border-border"
      }`}
    >
      <div className="flex items-center gap-1.5">
        {typeof a.index === "number" && (
          <input
            type="checkbox"
            checked={selected.has(a.index)}
            onClick={(e) => onCheckboxClick(e, a.index!)}
            onChange={() => {}}
            className="h-3.5 w-3.5 cursor-pointer"
            aria-label="Select action"
            title="Select (shift-click for range)"
            data-testid={`checkbox-action-${a.index}`}
          />
        )}
        <Badge variant="outline" className="text-[10px] py-0 px-1.5">
          {a.type}
        </Badge>
        {a.bffClass && (
          <Badge
            variant="outline"
            className={`text-[10px] py-0 px-1.5 ${
              a.bffClass === "bff"
                ? "border-emerald-500 text-emerald-600"
                : a.bffClass === "idp"
                  ? "border-amber-500 text-amber-600"
                  : "border-sky-500 text-sky-600"
            }`}
            data-testid={`action-bff-class-${a.index ?? i}`}
            title={
              a.bffClass === "bff"
                ? "Same-origin BFF endpoint"
                : a.bffClass === "idp"
                  ? "OAuth identity provider"
                  : "Cross-origin upstream API"
            }
          >
            {a.bffClass === "bff"
              ? "BFF"
              : a.bffClass === "idp"
                ? "IdP"
                : "Upstream"}
          </Badge>
        )}
        {a.strategy && <span className="text-primary">[{a.strategy}]</span>}
        {(a.decoratedMethodName ?? a.methodName ?? a.suggestedMethodName) && (
          <span
            className="text-foreground"
            data-testid={`action-method-name-${a.index ?? i}`}
          >
            {a.decoratedMethodName ?? a.methodName ?? a.suggestedMethodName}
            ()
          </span>
        )}
        {(a.decoratedMethodName ?? a.methodName ?? a.suggestedMethodName) &&
          typeof a.index === "number" && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                // Rename pre-fills with the bare noun for any
                // noun-flow language (C# `LoginButton` / Python
                // `login_button` / Node.js `loginButton`),
                // falling back to the recorder's suggested noun
                // and finally the displayed full name. The
                // server re-normalizes whatever the user types,
                // so pre-filling the noun just keeps the user
                // editing the same shape they originally typed.
                // The decorated form (when present) seeds the
                // live preview.
                const currentName =
                  a.methodName ??
                  a.suggestedNoun ??
                  a.suggestedMethodName ??
                  "";
                const decoratedSuggestion =
                  a.decoratedMethodName ?? undefined;
                window.dispatchEvent(
                  new CustomEvent("recorder:request-rename", {
                    detail: {
                      index: a.index!,
                      currentName,
                      actionType: a.type,
                      decoratedSuggestion,
                    },
                  }),
                );
              }}
              className="ml-auto inline-flex items-center justify-center rounded-sm p-0.5 text-muted-foreground hover-elevate"
              title="Rename action"
              aria-label="Rename action"
              data-testid={`button-rename-action-${a.index}`}
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        {typeof a.index === "number" &&
          (() => {
            const pos = visibleIndices.indexOf(a.index);
            const canMoveUp = pos > 0;
            const canMoveDown =
              pos !== -1 && pos < visibleIndices.length - 1;
            const editable = isEditableAction(a);
            const noLabel =
              !a.decoratedMethodName &&
              !a.methodName &&
              !a.suggestedMethodName;
            // Undo helpers — each mutating operation registers an
            // inverse via toast.action so the user can roll it
            // back optimistically without re-finding the row.
            // The inverse ops below assume no concurrent
            // mutations during the toast window; we accept that
            // limitation in exchange for not requiring a server-
            // side per-op history.
            const showMoveUndo = (
              label: string,
              undoDetail: { index: number; direction: "up" | "down" },
            ) => {
              toast.success(label, {
                duration: 6000,
                action: {
                  label: "Undo",
                  onClick: () => {
                    window.dispatchEvent(
                      new CustomEvent("recorder:request-move-action", {
                        detail: undoDetail,
                      }),
                    );
                  },
                },
              });
            };
            return (
              <div
                className={`${noLabel ? "ml-auto" : ""} inline-flex items-center gap-0.5`}
              >
                <button
                  type="button"
                  disabled={!canMoveUp}
                  onClick={(e) => {
                    e.stopPropagation();
                    // After server swap, this action lives at the
                    // previous visible neighbour's array index.
                    // Undo = move it back down.
                    const prevArrayIdx = visibleIndices[pos - 1];
                    window.dispatchEvent(
                      new CustomEvent("recorder:request-move-action", {
                        detail: { index: a.index!, direction: "up" },
                      }),
                    );
                    if (typeof prevArrayIdx === "number") {
                      showMoveUndo("Step moved up", {
                        index: prevArrayIdx,
                        direction: "down",
                      });
                    }
                  }}
                  className="inline-flex items-center justify-center rounded-sm p-0.5 text-muted-foreground hover-elevate disabled:opacity-30 disabled:hover:bg-transparent"
                  title="Move action up"
                  aria-label="Move action up"
                  data-testid={`button-move-up-action-${a.index}`}
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={!canMoveDown}
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextArrayIdx = visibleIndices[pos + 1];
                    window.dispatchEvent(
                      new CustomEvent("recorder:request-move-action", {
                        detail: { index: a.index!, direction: "down" },
                      }),
                    );
                    if (typeof nextArrayIdx === "number") {
                      showMoveUndo("Step moved down", {
                        index: nextArrayIdx,
                        direction: "up",
                      });
                    }
                  }}
                  className="inline-flex items-center justify-center rounded-sm p-0.5 text-muted-foreground hover-elevate disabled:opacity-30 disabled:hover:bg-transparent"
                  title="Move action down"
                  aria-label="Move action down"
                  data-testid={`button-move-down-action-${a.index}`}
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    // The server inserts the duplicate at array
                    // index `a.index + 1`. Undo = delete that row.
                    const insertedAt = a.index! + 1;
                    window.dispatchEvent(
                      new CustomEvent(
                        "recorder:request-duplicate-action",
                        { detail: { index: a.index! } },
                      ),
                    );
                    toast.success("Step duplicated", {
                      duration: 6000,
                      action: {
                        label: "Undo",
                        onClick: () => {
                          window.dispatchEvent(
                            new CustomEvent("recorder:request-delete", {
                              detail: { index: insertedAt },
                            }),
                          );
                        },
                      },
                    });
                  }}
                  className="inline-flex items-center justify-center rounded-sm p-0.5 text-muted-foreground hover-elevate"
                  title="Duplicate action"
                  aria-label="Duplicate action"
                  data-testid={`button-duplicate-action-${a.index}`}
                >
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Open the global add-assertion dialog with an
                    // `insertBeforeIndex` hint so the new step is
                    // spliced in front of the clicked row instead
                    // of being appended to the end of the feed.
                    // Undo for the insert is offered after the
                    // dialog confirms (see the
                    // `recorder:assertion-inserted` listener
                    // below).
                    window.dispatchEvent(
                      new CustomEvent(
                        "recorder:request-open-add-assertion",
                        { detail: { insertBeforeIndex: a.index! } },
                      ),
                    );
                  }}
                  className="inline-flex items-center justify-center rounded-sm p-0.5 text-muted-foreground hover-elevate"
                  title="Insert assertion before this step"
                  aria-label="Insert assertion before this step"
                  data-testid={`button-insert-before-action-${a.index}`}
                >
                  <CornerDownRight className="h-3 w-3" />
                </button>
                {editable && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Stash the prior action so EditValueDialog
                      // can register an undo toast bound to the
                      // pre-edit value once the user saves.
                      onEditValue({ ...a });
                    }}
                    className="inline-flex items-center justify-center rounded-sm p-0.5 text-muted-foreground hover-elevate"
                    title="Edit recorded value"
                    aria-label="Edit recorded value"
                    data-testid={`button-edit-value-action-${a.index}`}
                  >
                    <Pencil className="h-3 w-3 rotate-45" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.dispatchEvent(
                      new CustomEvent("recorder:request-delete", {
                        detail: { index: a.index! },
                      }),
                    );
                  }}
                  className="inline-flex items-center justify-center rounded-sm p-0.5 text-muted-foreground hover-elevate hover:text-destructive"
                  title="Delete action"
                  aria-label="Delete action"
                  data-testid={`button-delete-action-${a.index}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })()}
        {typeof a.index === "number" &&
          visibleIndices.indexOf(a.index) < visibleIndices.length - 1 && (
            <button
              type="button"
              onClick={(e) => onDeleteFromHere(e, a.index!)}
              className="inline-flex items-center justify-center rounded-sm p-0.5 text-muted-foreground hover-elevate hover:text-destructive"
              title="Delete this and all actions after"
              aria-label="Delete this and all actions after"
              data-testid={`button-delete-from-here-${a.index}`}
            >
              <ChevronsDown className="h-3 w-3" />
            </button>
          )}
      </div>
      <ActionRowDetails action={a} />
    </div>
  );
}
