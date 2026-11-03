import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { ChevronDown, Eye, EyeOff, Settings2, Sparkles } from "lucide-react";
import type { Language } from "@workspace/api-client-react";
import { ValidateItem } from "./workbench-actions-menu/validate-item";
import { OpenBrowserItem } from "./workbench-actions-menu/open-browser-item";
import { ExportItem } from "./workbench-actions-menu/export-item";
import { PipelineItem } from "./workbench-actions-menu/pipeline-item";

export interface WorkbenchActionsMenuProps {
  isApi: boolean;
  language?: Language | undefined;
  isExporting: boolean;
  onValidate: () => void;
  onExport: () => void;
  onOpenPipelineDialog: () => void;
  onOpenBrowser?: (() => void) | undefined;
  openBrowserDisabled?: boolean | undefined;
  openBrowserDisabledReason?: string | undefined;
  /**
   * JMX-only: shown as a small warning banner directly above the
   * Export action when the project's saved `JmxExportOptions`
   * have `embedCredentials: true`. Matches the wording mandated by
   * the JMX export spec.
   */
  jmxEmbedCredentialsWarning?: boolean | undefined;
  /**
   * JMX-only: current visibility of the Captured (HTTP requests)
   * panel. When provided alongside `onToggleJmxCaptured` and the
   * project language is `jmx`, a "Hide captured" / "Show captured"
   * toggle item is rendered in the menu.
   */
  jmxCapturedVisible?: boolean | undefined;
  /**
   * JMX-only: current visibility of the Recorded Actions side panel.
   * Same gating rules as `jmxCapturedVisible`.
   */
  jmxRecordedVisible?: boolean | undefined;
  onToggleJmxCaptured?: (() => void) | undefined;
  onToggleJmxRecorded?: (() => void) | undefined;
  /**
   * Opens the plain-English step / assertion authoring dialog.
   * Only rendered for non-API, non-JMX projects.
   */
  onOpenAiAuthor?: ((mode: "step" | "assertion") => void) | undefined;
}

/**
 * Dropdown that groups the workbench's project-level actions
 * (Validate, Export, Generate Pipeline File) under a single menu, sitting
 * immediately to the left of the Help menu in the toolbar. Mirrors the
 * Help menu's styling and chevron affordance.
 */
export function WorkbenchActionsMenu({
  isApi,
  language,
  isExporting,
  onValidate,
  onExport,
  onOpenPipelineDialog,
  onOpenBrowser,
  openBrowserDisabled,
  openBrowserDisabledReason,
  jmxEmbedCredentialsWarning,
  jmxCapturedVisible,
  jmxRecordedVisible,
  onToggleJmxCaptured,
  onToggleJmxRecorded,
  onOpenAiAuthor,
}: WorkbenchActionsMenuProps) {
  const showJmxToggles = language === "jmx";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          data-testid="button-workbench-actions-menu"
          aria-label="Actions"
        >
          <Settings2 className="h-3.5 w-3.5" />
          <span>Actions</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {!isApi && language !== "jmx" && <ValidateItem onValidate={onValidate} />}
        {!isApi && language !== "jmx" && onOpenAiAuthor && (
          <>
            <DropdownMenuItem
              onClick={() => onOpenAiAuthor("step")}
              data-testid="button-open-ai-step"
            >
              <Sparkles className="h-4 w-4 mr-2 text-amber-500" />
              Add step with AI
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onOpenAiAuthor("assertion")}
              data-testid="button-open-ai-assertion"
            >
              <Sparkles className="h-4 w-4 mr-2 text-amber-500" />
              Add assertion with AI
            </DropdownMenuItem>
          </>
        )}
        {!isApi && language !== "jmx" && onOpenBrowser && (
          <OpenBrowserItem
            onOpenBrowser={onOpenBrowser}
            disabled={openBrowserDisabled}
            disabledReason={openBrowserDisabledReason}
          />
        )}
        {jmxEmbedCredentialsWarning && (
          <div
            className="mx-2 my-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200"
            data-testid="warning-jmx-embed-credentials-export"
          >
            This JMX contains credentials in plaintext XML. Use only for
            local testing.
          </div>
        )}
        <ExportItem
          isExporting={isExporting}
          language={language}
          onExport={onExport}
        />
        {!isApi && language !== "jmx" && (
          <PipelineItem onOpenPipelineDialog={onOpenPipelineDialog} />
        )}
        {showJmxToggles && onToggleJmxCaptured && (
          <DropdownMenuItem
            onClick={onToggleJmxCaptured}
            data-testid="button-toggle-jmx-captured"
          >
            {jmxCapturedVisible ? (
              <EyeOff className="h-4 w-4 mr-2" />
            ) : (
              <Eye className="h-4 w-4 mr-2" />
            )}
            {jmxCapturedVisible ? "Hide captured" : "Show captured"}
          </DropdownMenuItem>
        )}
        {showJmxToggles && onToggleJmxRecorded && (
          <DropdownMenuItem
            onClick={onToggleJmxRecorded}
            data-testid="button-toggle-jmx-recorded"
          >
            {jmxRecordedVisible ? (
              <EyeOff className="h-4 w-4 mr-2" />
            ) : (
              <Eye className="h-4 w-4 mr-2" />
            )}
            {jmxRecordedVisible
              ? "Hide recorded actions"
              : "Show recorded actions"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
