import { Link } from "wouter";
import { cn } from "@/shared/utils/utils";

interface FooterEntry {
  name: string;
  testId: string;
  href: string;
  external: boolean;
}

const FOOTER_ENTRIES: FooterEntry[] = [
  { name: "Playwright", testId: "playwright", href: "https://playwright.dev", external: true },
  { name: ".NET", testId: "dotnet", href: "https://dotnet.microsoft.com", external: true },
  { name: "Python", testId: "python", href: "https://www.python.org", external: true },
  { name: "Node.js", testId: "nodejs", href: "https://nodejs.org", external: true },
  { name: "Java", testId: "java", href: "https://www.java.com", external: true },
  { name: "About", testId: "about", href: "/about", external: false },
  { name: "Privacy", testId: "privacy", href: "/privacy", external: false },
  { name: "Terms", testId: "terms", href: "/terms", external: false },
];

interface FooterProps {
  className?: string;
}

export function Footer({ className }: FooterProps) {
  return (
    <footer
      className={cn(
        "shrink-0 border-t border-border bg-card/40 px-4 py-2 text-xs text-muted-foreground flex items-center justify-center flex-wrap gap-x-1.5 gap-y-1",
        className,
      )}
      data-testid="footer-tech-stack"
    >
      {FOOTER_ENTRIES.map((entry, i) => (
        <span key={entry.name} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden className="opacity-40">·</span>}
          {entry.external ? (
            <a
              href={entry.href}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground underline-offset-2 hover:underline transition-colors"
              data-testid={`footer-link-${entry.testId}`}
            >
              {entry.name}
            </a>
          ) : (
            <Link
              href={entry.href}
              className="hover:text-foreground underline-offset-2 hover:underline transition-colors"
              data-testid={`footer-link-${entry.testId}`}
            >
              {entry.name}
            </Link>
          )}
        </span>
      ))}
    </footer>
  );
}
