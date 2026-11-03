export type SyntaxLang =
  | "js"
  | "cs"
  | "java"
  | "py"
  | "json"
  | "xml"
  | "css"
  | "plain";

export interface Token {
  text: string;
  cls: string;
}

export const KEYWORDS: Record<SyntaxLang, Set<string>> = {
  js: new Set([
    "const", "let", "var", "function", "return", "if", "else", "for", "while",
    "do", "switch", "case", "break", "continue", "class", "extends", "new",
    "this", "import", "export", "from", "as", "default", "await", "async",
    "try", "catch", "finally", "throw", "typeof", "instanceof", "in", "of",
    "true", "false", "null", "undefined", "void", "interface", "type", "enum",
  ]),
  cs: new Set([
    "using", "namespace", "class", "public", "private", "protected", "internal",
    "static", "void", "var", "new", "return", "if", "else", "for", "foreach",
    "while", "do", "switch", "case", "break", "continue", "this", "base",
    "throw", "try", "catch", "finally", "true", "false", "null", "string",
    "int", "bool", "double", "float", "long", "short", "char", "object",
    "interface", "enum", "struct", "override", "virtual", "abstract", "sealed",
    "async", "await", "in", "out", "ref",
  ]),
  java: new Set([
    "public", "private", "protected", "class", "interface", "extends", "implements",
    "static", "final", "void", "new", "return", "if", "else", "for", "while",
    "do", "switch", "case", "break", "continue", "this", "super", "throw",
    "throws", "try", "catch", "finally", "true", "false", "null", "package",
    "import", "abstract", "synchronized", "volatile", "transient", "native",
    "int", "boolean", "double", "float", "long", "short", "char", "byte",
  ]),
  py: new Set([
    "def", "class", "return", "if", "elif", "else", "for", "while", "break",
    "continue", "import", "from", "as", "pass", "with", "try", "except",
    "finally", "raise", "True", "False", "None", "and", "or", "not", "in",
    "is", "lambda", "yield", "global", "nonlocal", "async", "await",
  ]),
  json: new Set(["true", "false", "null"]),
  xml: new Set(),
  css: new Set(),
  plain: new Set(),
};

export function languageFor(filePath: string): SyntaxLang {
  const lower = filePath.toLowerCase();
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  )
    return "js";
  if (lower.endsWith(".cs")) return "cs";
  if (lower.endsWith(".java")) return "java";
  if (lower.endsWith(".py")) return "py";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xml"))
    return "xml";
  if (lower.endsWith(".css") || lower.endsWith(".scss")) return "css";
  return "plain";
}

export function tokenize(line: string, lang: SyntaxLang): Token[] {
  if (line === "") return [];
  if (lang === "plain" || lang === "xml" || lang === "css") {
    return [{ text: line, cls: "" }];
  }
  const out: Token[] = [];
  const kws = KEYWORDS[lang];
  const len = line.length;
  let i = 0;
  const commentSingle = lang === "py" ? "#" : "//";
  const supportsBlockComment = lang !== "py";
  while (i < len) {
    const ch = line[i];
    if (line.startsWith(commentSingle, i)) {
      out.push({ text: line.slice(i), cls: "text-slate-500 italic" });
      i = len;
      break;
    }
    if (supportsBlockComment && line.startsWith("/*", i)) {
      const end = line.indexOf("*/", i + 2);
      if (end === -1) {
        out.push({ text: line.slice(i), cls: "text-slate-500 italic" });
        i = len;
        break;
      }
      out.push({ text: line.slice(i, end + 2), cls: "text-slate-500 italic" });
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < len) {
        if (line[j] === "\\") { j += 2; continue; }
        if (line[j] === quote) { j++; break; }
        j++;
      }
      out.push({ text: line.slice(i, j), cls: "text-emerald-400" });
      i = j;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      let j = i + 1;
      while (j < len && /[0-9_.eExX+\-a-fA-F]/.test(line[j])) {
        if ((line[j] === "+" || line[j] === "-") && line[j - 1] !== "e" && line[j - 1] !== "E") break;
        j++;
      }
      out.push({ text: line.slice(i, j), cls: "text-amber-400" });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < len && /[A-Za-z0-9_$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      out.push({ text: word, cls: kws.has(word) ? "text-sky-400" : "" });
      i = j;
      continue;
    }
    let j = i + 1;
    while (
      j < len &&
      !/[A-Za-z0-9_$"'`]/.test(line[j]) &&
      !line.startsWith(commentSingle, j) &&
      !(supportsBlockComment && line.startsWith("/*", j))
    ) {
      j++;
    }
    out.push({ text: line.slice(i, j), cls: "" });
    i = j;
  }
  return out;
}
