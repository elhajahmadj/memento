import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Sparkles, Upload } from "lucide-react";
import {
  useCreateProject,
  useListAvailableProjects,
  useStartAiAgentRun,
  getGetCurrentProjectQueryKey,
  Language,
  SolutionType,
  type Language as LanguageType,
  type SolutionType as SolutionTypeT,
  type AiAgentRunRequestKind,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

type Mode = "existing" | "new";

const PLAYWRIGHT_DEFAULT = "PlaywrightSuite";
const API_DEFAULT = "AutomationAPI";

function defaultArchIdFor(language: LanguageType, solutionType: SolutionTypeT): string {
  if (solutionType === SolutionType.api) {
    if (language === Language.python) return "api-default-python";
    if (language === Language.nodejs) return "api-default-nodejs";
    if (language === Language.java) return "api-default-java";
    return "api-default-csharp";
  }
  if (language === Language.python) return "python-default";
  if (language === Language.nodejs) return "nodejs-default";
  if (language === Language.java) return "java-default";
  return "default";
}

export function BuildWithAiProjectsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [mode, setMode] = useState<Mode>("existing");
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [plan, setPlan] = useState("");
  const [suiteName, setSuiteName] = useState("");

  // Scaffold-new fields
  const [solutionType, setSolutionType] = useState<SolutionTypeT>(
    SolutionType.playwright,
  );
  const [language, setLanguage] = useState<LanguageType>(Language.csharp);
  const [solutionName, setSolutionName] = useState(PLAYWRIGHT_DEFAULT);

  function reset() {
    setMode("existing");
    setSelectedProject("");
    setPlan("");
    setSuiteName("");
    setSolutionType(SolutionType.playwright);
    setLanguage(Language.csharp);
    setSolutionName(PLAYWRIGHT_DEFAULT);
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  useEffect(() => {
    setSolutionName(
      solutionType === SolutionType.api ? API_DEFAULT : PLAYWRIGHT_DEFAULT,
    );
  }, [solutionType]);

  const { data: available } = useListAvailableProjects({
    query: { enabled: open, queryKey: ["listAvailableProjects"] },
  });

  const projectChoices = useMemo(
    () => (available ?? []).filter((p) => !p.disabled),
    [available],
  );

  // When dialog re-opens, default to "new" if there are no projects yet.
  useEffect(() => {
    if (open && projectChoices.length === 0) setMode("new");
  }, [open, projectChoices.length]);

  const startRun = useStartAiAgentRun({
    mutation: {
      onSuccess: (r, vars) => {
        toast.success("AI run started");
        onOpenChange(false);
        navigate(
          `/workbench/ai-runs/${encodeURIComponent(vars.projectName)}/${r.id}`,
        );
      },
      onError: (e: unknown) =>
        toast.error(`Run failed to start: ${(e as Error).message ?? ""}`),
    },
  });

  const create = useCreateProject({
    mutation: {
      onSuccess: async (_data, vars) => {
        await qc.invalidateQueries({ queryKey: getGetCurrentProjectQueryKey() });
        toast.success("Project scaffolded — kicking off AI run");
        const projectName = vars.data.solutionName;
        const kind: AiAgentRunRequestKind =
          vars.data.solutionType === SolutionType.api ? "api" : "playwright";
        const lang = (vars.data.language ?? Language.csharp) as
          | "csharp"
          | "python"
          | "nodejs"
          | "java";
        startRun.mutate({
          projectName,
          data: {
            kind,
            plan,
            suiteName: suiteName.trim() || `${projectName}Smoke`,
            category: null,
            language: lang,
            targetMode: "new_suite",
            existingSuiteFile: null,
          },
        });
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to scaffold project"),
    },
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPlan(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  const busy = create.isPending || startRun.isPending;
  const canSubmit =
    !!plan.trim() &&
    !busy &&
    (mode === "existing"
      ? !!selectedProject &&
        !!suiteName.trim() &&
        !!projectChoices.find((p) => p.solutionName === selectedProject)
      : !!solutionName.trim());

  function handleStart() {
    if (mode === "existing") {
      const proj = projectChoices.find(
        (p) => p.solutionName === selectedProject,
      );
      if (!proj) return;
      const kind: AiAgentRunRequestKind =
        proj.solutionType === SolutionType.api ? "api" : "playwright";
      const lang = (proj.language ?? Language.csharp) as
        | "csharp"
        | "python"
        | "nodejs"
        | "java";
      startRun.mutate({
        projectName: proj.solutionName,
        data: {
          kind,
          plan,
          suiteName: suiteName.trim(),
          category: null,
          language: lang,
          targetMode: "new_suite",
          existingSuiteFile: null,
        },
      });
    } else {
      create.mutate({
        data: {
          solutionName,
          testProjectName: `${solutionName}.Tests`,
          namespace: solutionName,
          architectureId: defaultArchIdFor(language, solutionType),
          language,
          solutionType,
        },
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Build with AI
          </DialogTitle>
          <DialogDescription>
            Pick an existing project or scaffold a brand-new one, then describe
            in plain English what the AI agent should build.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Where should this run?</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as Mode)}
              className="grid grid-cols-1 sm:grid-cols-2 gap-2"
            >
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer text-sm">
                <RadioGroupItem
                  value="existing"
                  id="bw-mode-existing"
                  data-testid="radio-bw-mode-existing"
                  className="mt-0.5"
                  disabled={projectChoices.length === 0}
                />
                <span>
                  <span className="font-medium block">Existing project</span>
                  <span className="text-muted-foreground text-xs">
                    Run the AI agent against a project you already have.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer text-sm">
                <RadioGroupItem
                  value="new"
                  id="bw-mode-new"
                  data-testid="radio-bw-mode-new"
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium block">Scaffold a new project</span>
                  <span className="text-muted-foreground text-xs">
                    Create a fresh project, then immediately build into it.
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>

          {mode === "existing" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Project</Label>
                <Select
                  value={selectedProject}
                  onValueChange={setSelectedProject}
                >
                  <SelectTrigger data-testid="select-bw-existing-project">
                    <SelectValue
                      placeholder={
                        projectChoices.length === 0
                          ? "No projects available"
                          : "Pick a project…"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {projectChoices.map((p) => (
                      <SelectItem
                        key={p.solutionName}
                        value={p.solutionName}
                        data-testid={`option-bw-project-${p.solutionName}`}
                      >
                        {p.solutionName}{" "}
                        <span className="text-muted-foreground">
                          (
                          {p.solutionType === SolutionType.api
                            ? "API"
                            : "Playwright"}{" "}
                          / {p.language ?? "csharp"})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Suite / file name</Label>
                <Input
                  value={suiteName}
                  onChange={(e) => setSuiteName(e.target.value)}
                  placeholder="LoginSmoke"
                  data-testid="input-bw-suite-name"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Solution type</Label>
                  <RadioGroup
                    value={solutionType}
                    onValueChange={(v) => setSolutionType(v as SolutionTypeT)}
                    className="flex gap-4 pt-2"
                  >
                    <label className="flex items-center gap-2 text-sm">
                      <RadioGroupItem
                        value={SolutionType.playwright}
                        data-testid="radio-bw-new-playwright"
                      />
                      Playwright (UI)
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <RadioGroupItem
                        value={SolutionType.api}
                        data-testid="radio-bw-new-api"
                      />
                      API
                    </label>
                  </RadioGroup>
                </div>
                <div>
                  <Label>Language</Label>
                  <Select
                    value={language}
                    onValueChange={(v) => setLanguage(v as LanguageType)}
                  >
                    <SelectTrigger data-testid="select-bw-new-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={Language.csharp}>C# (.NET / NUnit)</SelectItem>
                      <SelectItem value={Language.python}>Python (pytest)</SelectItem>
                      <SelectItem value={Language.nodejs}>Node.js (Playwright Test)</SelectItem>
                      <SelectItem value={Language.java}>Java (JUnit 5 + Playwright)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Solution name</Label>
                <Input
                  value={solutionName}
                  onChange={(e) => setSolutionName(e.target.value)}
                  data-testid="input-bw-new-solution-name"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Test project will be <code>{solutionName}.Tests</code>.
                  Architecture defaults to the language preset.
                </p>
              </div>
            </div>
          )}

          <div>
            <Label className="flex items-center justify-between">
              <span>Plan</span>
              <label className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
                <Upload className="h-3 w-3" />
                Upload .txt/.md
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  onChange={handleFile}
                  className="hidden"
                  data-testid="input-bw-plan-file"
                />
              </label>
            </Label>
            <Textarea
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder={
                "1. Open the login page\n2. Sign in as alice\n3. Verify the dashboard shows 'Welcome, Alice'"
              }
              rows={10}
              className="font-mono text-sm"
              data-testid="textarea-bw-plan"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            data-testid="button-bw-cancel"
          >
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={handleStart}
            data-testid="button-bw-start"
          >
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {mode === "new" ? "Scaffold & build" : "Start AI run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
