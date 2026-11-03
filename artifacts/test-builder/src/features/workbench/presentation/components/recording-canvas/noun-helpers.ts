import {
  csharpMethodNameFromNoun,
  nodejsMethodNameFromNoun,
  normalizeNounForCsharp,
  normalizeNounForNodejs,
  normalizeNounForPython,
  pythonMethodNameFromNoun,
} from "@/features/codegen";
import type { RecordingLanguage } from "./types";

/**
 * Derive a sensible default action-name suggestion for the combined
 * fill+name dialog from an editable element's label (testid / id /
 * aria-label / name / placeholder). The label is split on any
 * non-alphanumeric run and re-joined per language convention:
 *   - csharp: PascalCase noun (e.g. `Username`)
 *   - python: snake_case identifier (e.g. `username`)
 *   - nodejs: camelCase identifier (e.g. `username`)
 *   - java:   PascalCase noun, mirroring csharp
 * Returns an empty string when the label produced no usable tokens; the
 * server still applies its own suggestion for the synthetic fill so the
 * dialog never blocks on an un-suggestable label.
 */
export function defaultFillNameForLanguage(
  label: string,
  language: RecordingLanguage,
): string {
  const tokens = String(label || "")
    .split(/[^A-Za-z0-9]+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  if (language === "python") {
    return tokens.map((t) => t.toLowerCase()).join("_");
  }
  if (language === "nodejs") {
    return tokens
      .map((t, i) =>
        i === 0
          ? t.toLowerCase()
          : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(),
      )
      .join("");
  }
  // csharp / java — PascalCase
  return tokens
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join("");
}

export function isNounLanguage(lang: RecordingLanguage): boolean {
  return lang === "csharp" || lang === "python" || lang === "nodejs";
}

export function normalizeNounForLanguage(
  raw: string,
  lang: RecordingLanguage,
): string {
  switch (lang) {
    case "python":
      return normalizeNounForPython(raw);
    case "nodejs":
      return normalizeNounForNodejs(raw);
    case "java":
      return raw.trim();
    default:
      return normalizeNounForCsharp(raw);
  }
}

export function methodNameFromNounForLanguage(
  type: string,
  noun: string,
  lang: RecordingLanguage,
): string {
  switch (lang) {
    case "python":
      return pythonMethodNameFromNoun(type, noun);
    case "nodejs":
      return nodejsMethodNameFromNoun(type, noun);
    case "java":
      return noun;
    default:
      return csharpMethodNameFromNoun(type, noun);
  }
}
