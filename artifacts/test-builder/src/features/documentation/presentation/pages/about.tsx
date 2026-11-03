import { PageShell } from "@/shared/ui/shell/page-shell";
import { Card, CardContent } from "@/shared/ui/card";
import { useIsGuest } from "@/features/auth/presentation/role";
import { Mail } from "lucide-react";

const APP_VERSION = "1.0.0";

export function About() {
  const isGuest = useIsGuest();
  return (
    <PageShell
      contentClassName="max-w-4xl"
      backTestId="button-about-back"
      backLabel="Back to home"
    >
      <h1
        className="text-3xl font-semibold mb-2"
        data-testid="text-about-title"
      >
        About
      </h1>
      <p className="text-muted-foreground mb-2">
        A quick overview of what this app does and who built it.
      </p>
      <p
        className="text-xs text-muted-foreground mb-8"
        data-testid="text-about-version"
      >
        Version {APP_VERSION}
      </p>

      <Card className="border-card-border mb-8">
        <CardContent className="p-6 space-y-3">
          <h2 className="text-xl font-semibold">What this app does</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Playwright Test Builder turns real browser clicks and API calls
            into clean, page-object-style tests — no boilerplate required.
            Scaffold a project from an architecture template, point the
            recorder at a URL or describe an endpoint in the Build API test
            dialog, and the steps land directly in the test method or shared
            hook you picked.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Both UI and API tests ship in all four supported languages: C#,
            Python, Node.js, and Java. UI tests use Playwright (NUnit, pytest,
            @playwright/test, and JUnit 5 respectively). API tests use the
            native HTTP stack for each language — xUnit + HttpClient for C#,
            pytest + httpx for Python, Vitest + undici for Node.js, and
            JUnit 5 + java.net.http for Java. The output is a real, runnable
            project you can hand to any team.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Access is role-based. Admins own the canonical projects, limited
            admins review changes for a scoped subset of them, and regular
            users iterate in personal forks and submit their work back for
            review.
          </p>
        </CardContent>
      </Card>

      <Card
        className="border-card-border relative overflow-hidden"
        data-testid="card-about-creator"
      >
        <span
          aria-hidden="true"
          className="text-brand-gradient pointer-events-none select-none absolute right-4 top-1/2 -translate-y-1/2 font-semibold tracking-tight leading-none text-[10rem] opacity-15 dark:opacity-20"
        >
          m
        </span>
        <CardContent className="relative p-6 space-y-3">
          <h2 className="text-base font-medium">Created by</h2>
          <div className="space-y-1">
            <p
              className="text-sm text-muted-foreground"
              data-testid="text-about-creator-name"
            >
              Ahmad Elhaj
            </p>
            <p
              className="text-sm text-muted-foreground"
              data-testid="text-about-creator-title"
            >
              SDET
            </p>
            <p className="text-sm">
              <a
                href="mailto:ElhajAhmadJ@gmail.com"
                className="inline-flex items-center gap-1.5 text-primary hover:underline"
                data-testid="link-about-creator-email"
              >
                <Mail className="h-3.5 w-3.5" />
                ElhajAhmadJ@gmail.com
              </a>
            </p>
            {/* Guests are on a six-hour trial with a single project, so
                this is the one place worth telling them how to get a
                real account. Shown only to them — signed-in users
                already have access. */}
            {isGuest && (
              <p
                className="text-sm text-muted-foreground"
                data-testid="text-about-guest-upgrade"
              >
                Email to get full access to memento
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
