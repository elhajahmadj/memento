import { Language, type Language as LanguageType } from "@workspace/api-client-react";

export function LanguageBadge({ language }: { language?: LanguageType | undefined }) {
  if (!language) return null;
  const label =
    language === Language.python
      ? "Python"
      : language === Language.nodejs
        ? "Node.js"
        : language === Language.java
          ? "Java"
          : "C#";
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground uppercase tracking-wide">
      {label}
    </span>
  );
}
