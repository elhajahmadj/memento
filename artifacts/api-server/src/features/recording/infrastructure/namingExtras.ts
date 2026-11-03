import type { Project } from "@/features/projects/domain/types";
import type { RecordedAction } from "@/features/codegen/domain/types";
import {
  suggestedActionNoun,
  suggestedMethodNameForLastAction,
  usesNounPromptFlow,
} from "@/features/codegen/infrastructure/codegenAdapter";

/**
 * Compute the auto-generated `suggestedMethodName` plus the C#-only
 * `suggestedNoun` / `decoratedMethodName` extras the workbench renders
 * next to the prompt. Pure dispatcher over project.language.
 *
 * Lives in the recording infrastructure layer because it depends on
 * the codegen infrastructure adapter; the rest of recording's naming
 * helpers are pure and stay in `domain/naming.ts`.
 */
export function computeNamingExtras(
  liveActions: RecordedAction[],
  hasSelector: boolean,
  project: Project | null,
): {
  suggestedMethodName: string | null;
  suggestedNoun: string | null;
  decoratedMethodName: string | null;
} {
  if (!hasSelector) {
    return {
      suggestedMethodName: null,
      suggestedNoun: null,
      decoratedMethodName: null,
    };
  }
  const dispatchProject =
    project ?? ({ language: "csharp" } as unknown as Project);
  const suggested = suggestedMethodNameForLastAction(
    dispatchProject,
    liveActions,
  );
  if (!usesNounPromptFlow(dispatchProject)) {
    return {
      suggestedMethodName: suggested,
      suggestedNoun: null,
      decoratedMethodName: null,
    };
  }
  return {
    suggestedMethodName: suggested,
    suggestedNoun: suggestedActionNoun(dispatchProject, liveActions),
    decoratedMethodName: suggested,
  };
}
