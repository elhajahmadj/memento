import { useState, useMemo, useRef } from "react";
import { Eye, Pencil, Search as SearchIcon } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import vs from "react-syntax-highlighter/dist/esm/styles/prism/vs";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { xml } from "@codemirror/lang-xml";
import { json } from "@codemirror/lang-json";
import { StreamLanguage } from "@codemirror/language";
import { csharp } from "@codemirror/legacy-modes/mode/clike";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { useTheme } from "@/shared/hooks/use-theme";

function archLanguageFor(pathLabel: string): string {
  if (pathLabel.endsWith(".cs")) return "csharp";
  if (
    pathLabel.endsWith(".csproj") ||
    pathLabel.endsWith(".sln") ||
    pathLabel.endsWith(".runsettings") ||
    pathLabel.endsWith(".props") ||
    pathLabel.endsWith(".targets") ||
    pathLabel.endsWith(".config") ||
    pathLabel.endsWith(".xml")
  )
    return "xml";
  if (pathLabel.endsWith(".json")) return "json";
  return "text";
}

function codeMirrorExtensionsFor(language: string) {
  const tabKeymap = keymap.of([indentWithTab]);
  const searchExt = search({ top: true });
  const searchKeys = keymap.of(searchKeymap);
  const common = [searchExt, searchKeys, tabKeymap];
  switch (language) {
    case "csharp":
      return [StreamLanguage.define(csharp), ...common];
    case "xml":
      return [xml(), ...common];
    case "json":
      return [json(), ...common];
    default:
      return [...common];
  }
}

export function ArchFileEditor({
  pathLabel,
  content,
  onChange,
}: {
  pathLabel: string;
  content: string;
  onChange: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const language = useMemo(() => archLanguageFor(pathLabel), [pathLabel]);
  const { theme } = useTheme();
  const useDarkEditor = theme !== "light";
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  const handleOpenSearch = () => {
    const view = cmRef.current?.view;
    if (view) {
      openSearchPanel(view);
      view.focus();
    }
  };

  return (
    <>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="font-mono text-sm truncate">{pathLabel}</div>
        <div className="flex items-center gap-1">
          {editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenSearch}
              data-testid="button-find-replace-arch-file"
              title="Find & replace (Ctrl+F)"
            >
              <SearchIcon className="h-3.5 w-3.5 mr-1.5" /> Find
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing((v) => !v)}
            data-testid="button-toggle-edit-arch-file"
          >
            {editing ? (
              <>
                <Eye className="h-3.5 w-3.5 mr-1.5" /> View
              </>
            ) : (
              <>
                <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
              </>
            )}
          </Button>
        </div>
      </div>
      {editing ? (
        <div
          className="flex-1 min-h-0 overflow-auto"
          data-testid="textarea-arch-file"
        >
          <CodeMirror
            ref={cmRef}
            value={content}
            onChange={(v) => onChange(v)}
            theme={useDarkEditor ? vscodeDark : vscodeLight}
            extensions={codeMirrorExtensionsFor(language)}
            height="100%"
            style={{ height: "100%", fontSize: 13 }}
            basicSetup={{
              lineNumbers: true,
              indentOnInput: true,
              tabSize: 2,
              highlightActiveLine: true,
              highlightActiveLineGutter: true,
              foldGutter: true,
              bracketMatching: true,
              autocompletion: true,
            }}
          />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <SyntaxHighlighter
            language={language}
            style={useDarkEditor ? vscDarkPlus : vs}
            customStyle={{
              margin: 0,
              background: "transparent",
              fontSize: "13px",
              padding: "16px",
            }}
            showLineNumbers
          >
            {content}
          </SyntaxHighlighter>
        </ScrollArea>
      )}
    </>
  );
}
