import { tokenize, type SyntaxLang } from "../../domain/syntax-highlight";

export function HighlightedLine({
  text,
  lang,
}: {
  text: string | null;
  lang: SyntaxLang;
}) {
  if (text === null) return <>&nbsp;</>;
  if (text === "") return <>&nbsp;</>;
  const tokens = tokenize(text, lang);
  return (
    <>
      {tokens.map((t, i) =>
        t.cls ? (
          <span key={i} className={t.cls}>
            {t.text}
          </span>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </>
  );
}
