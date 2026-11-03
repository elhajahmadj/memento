import {
  useState,
  useEffect,
  useMemo,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  useGetFileContent,
  useUpdateFile,
  getGetFileContentQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  Copy,
  Loader2,
  Code2,
  Pencil,
  Save,
  X,
} from "lucide-react";
import { AnyAdminOnly as AdminOnly } from "@/features/auth/presentation/role";

import { invalidateDiscoveredTests } from "@/features/workbench/presentation/lib/invalidate-discovered-tests";

export function CodeViewerPanel({ selectedPath }: { selectedPath: string | null }) {
  const qc = useQueryClient();
  const enabled = !!selectedPath;
  const { data, isLoading } = useGetFileContent(
    { path: selectedPath ?? "" },
    {
      query: {
        enabled,
        queryKey: getGetFileContentQueryKey({ path: selectedPath ?? "" }),
      },
    },
  );

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setEditing(false);
    setDraft(data?.content ?? "");
  }, [selectedPath, data?.content]);

  const update = useUpdateFile({
    mutation: {
      onSuccess: async () => {
        toast.success("File saved");
        setEditing(false);
        if (selectedPath) {
          await qc.invalidateQueries({
            queryKey: getGetFileContentQueryKey({ path: selectedPath }),
          });
        }
        await invalidateDiscoveredTests(qc);
      },
      onError: (e: unknown) => {
        toast.error(`Save failed: ${(e as Error).message}`);
      },
    },
  });

  const language = useMemo(() => {
    if (!selectedPath) return "csharp";
    if (selectedPath.endsWith(".cs")) return "csharp";
    if (
      selectedPath.endsWith(".csproj") ||
      selectedPath.endsWith(".sln") ||
      selectedPath.endsWith("pom.xml") ||
      selectedPath.endsWith(".xml")
    )
      return "xml";
    if (selectedPath.endsWith(".json")) return "json";
    if (selectedPath.endsWith(".java")) return "java";
    return "text";
  }, [selectedPath]);

  if (!selectedPath) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
        <Code2 className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-sm">Select a file to view its contents</p>
      </div>
    );
  }

  const dirty = editing && draft !== (data?.content ?? "");

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="h-9 px-3 border-b border-border flex items-center justify-between text-xs font-mono">
        <span className="text-muted-foreground truncate">
          {selectedPath}
          {dirty && <span className="ml-2 text-primary">• unsaved</span>}
        </span>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  setEditing(false);
                  setDraft(data?.content ?? "");
                }}
                disabled={update.isPending}
                data-testid="button-cancel-edit"
                title="Cancel"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() =>
                  update.mutate({
                    data: { path: selectedPath, content: draft },
                  })
                }
                disabled={update.isPending || !dirty}
                data-testid="button-save-edit"
                title="Save"
              >
                {update.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  if (data?.content) {
                    navigator.clipboard.writeText(data.content);
                    toast.success("Copied to clipboard");
                  }
                }}
                data-testid="button-copy-code"
                title="Copy"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <AdminOnly>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  setDraft(data?.content ?? "");
                  setEditing(true);
                }}
                disabled={isLoading}
                data-testid="button-edit-file"
                title="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              </AdminOnly>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="flex-1 w-full resize-none bg-background text-foreground font-mono text-[13px] leading-5 p-4 outline-none border-0"
          data-testid="textarea-file-editor"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
              e.preventDefault();
              if (dirty && !update.isPending) {
                update.mutate({
                  data: { path: selectedPath, content: draft },
                });
              }
            }
          }}
        />
      ) : (
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="p-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <SyntaxHighlighter
              language={language}
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                background: "transparent",
                fontSize: "13px",
                padding: "16px",
              }}
              showLineNumbers
            >
              {data?.content ?? ""}
            </SyntaxHighlighter>
          )}
        </ScrollArea>
      )}
    </div>
  );
}
