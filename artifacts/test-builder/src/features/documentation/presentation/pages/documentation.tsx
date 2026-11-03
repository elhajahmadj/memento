import { useEffect, useMemo } from "react";
import { useParams, useLocation, Link } from "wouter";
import { ChevronRight, BookOpen } from "lucide-react";
import { PageShell } from "@/shared/ui/shell/page-shell";
import { Card, CardContent } from "@/shared/ui/card";
import { cn } from "@/shared/utils/utils";
import { useRole } from "@/features/auth/presentation/role";
import {
  DOCS_MATRIX,
  entriesForRole,
  groupByCategory,
  permissionsNote,
  screenshotSrc,
  screenshotKeys,
  type DocsMatrixEntry,
} from "@/lib/docs/matrix";
import { contentForSection } from "@/lib/docs/content";

/**
 * Role-aware documentation page. Renders a left-hand sidebar of every
 * section the current role can reach in the live app, plus a main pane
 * with the section template (intro, screenshot, walkthrough, fields,
 * permissions). The current section is URL-addressable via
 * `/documentation/:sectionId` so links from anywhere in the app — and
 * from external docs — can deep-link directly to a topic.
 */
export function Documentation() {
  const role = useRole();
  const params = useParams<{ sectionId?: string }>();
  const [, navigate] = useLocation();

  const visibleEntries = useMemo(() => entriesForRole(role), [role]);
  const visibleIds = useMemo(
    () => new Set(visibleEntries.map((e) => e.sectionId)),
    [visibleEntries],
  );

  // Resolve the active section. If the URL points at a section the
  // viewer can't see (or no section), fall back to the first visible
  // entry. Redirect the URL so the breadcrumb / browser back button
  // stay coherent.
  const requestedId = params.sectionId;
  // Default landing section for signed-in viewers. The matrix's first
  // entry is "landing" — the signed-out marketing surface — which is a
  // poor default for someone already signed in. Prefer "home" when the
  // viewer can see it, then fall back to the first visible non-landing
  // entry, then to the very first visible entry.
  const defaultEntry =
    visibleEntries.find((e) => e.sectionId === "home") ??
    visibleEntries.find((e) => e.sectionId !== "landing") ??
    visibleEntries[0];
  const activeEntry: DocsMatrixEntry | null =
    (requestedId && visibleIds.has(requestedId)
      ? visibleEntries.find((e) => e.sectionId === requestedId)
      : defaultEntry) ?? null;

  useEffect(() => {
    if (!activeEntry) return;
    if (requestedId && requestedId === activeEntry.sectionId) return;
    if (!requestedId) {
      navigate(`/documentation/${activeEntry.sectionId}`, { replace: true });
      return;
    }
    // Requested an id we can't show — silently land on the first
    // section the viewer can reach.
    navigate(`/documentation/${activeEntry.sectionId}`, { replace: true });
  }, [activeEntry, requestedId, navigate]);

  return (
    <PageShell
      contentClassName="max-w-7xl w-full"
      backTestId="button-documentation-back"
      backLabel="Back to home"
    >
      <h1
        className="text-3xl font-semibold mb-2"
        data-testid="text-documentation-title"
      >
        Documentation
      </h1>
      <p className="text-muted-foreground mb-8">
        A guided tour of every page available to you, with screenshots from
        the live app.
      </p>

      {visibleEntries.length === 0 ? (
        <div
          className="text-center py-12 text-sm text-muted-foreground border border-card-border rounded-md bg-card"
          data-testid="documentation-empty"
        >
          Sign in to see documentation tailored to your role.
        </div>
      ) : (
        <div
          className="grid gap-6 md:grid-cols-[260px_minmax(0,1fr)]"
          data-testid="documentation-layout"
        >
          <DocsSidebar
            entries={visibleEntries}
            activeId={activeEntry?.sectionId ?? null}
          />
          <main data-testid="documentation-main">
            {activeEntry ? (
              <DocsSection entry={activeEntry} role={role} />
            ) : null}
          </main>
        </div>
      )}
    </PageShell>
  );
}

function DocsSidebar({
  entries,
  activeId,
}: {
  entries: DocsMatrixEntry[];
  activeId: string | null;
}) {
  const groups = useMemo(() => groupByCategory(entries), [entries]);
  return (
    <aside
      className="border border-card-border rounded-md bg-card p-3 self-start sticky top-20"
      data-testid="documentation-sidebar"
      aria-label="Documentation sections"
    >
      <nav className="space-y-4">
        {groups.map((group) => (
          <div key={group.category}>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground px-2 mb-1.5">
              {group.category}
            </h2>
            <ul className="space-y-0.5">
              {group.entries.map((entry) => {
                const active = entry.sectionId === activeId;
                return (
                  <li key={entry.sectionId}>
                    <Link
                      href={`/documentation/${entry.sectionId}`}
                      data-testid={`documentation-nav-${entry.sectionId}`}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors hover-elevate",
                        active
                          ? "bg-brand-gradient-soft text-foreground border border-primary/20"
                          : "text-muted-foreground border border-transparent",
                      )}
                    >
                      {active ? (
                        <ChevronRight className="h-3.5 w-3.5 text-primary shrink-0" />
                      ) : (
                        <BookOpen className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="truncate">{entry.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function DocsSection({
  entry,
  role,
}: {
  entry: DocsMatrixEntry;
  role: ReturnType<typeof useRole>;
}) {
  const content = contentForSection(entry.sectionId);
  const screenshot = screenshotSrc(entry, role, import.meta.env.BASE_URL);
  const extraScreenshots =
    role === null
      ? []
      : screenshotKeys(entry)
          .slice(1)
          .map((key) => {
            const base = import.meta.env.BASE_URL.endsWith("/")
              ? import.meta.env.BASE_URL
              : `${import.meta.env.BASE_URL}/`;
            return { key, src: `${base}images/docs/${role}/${key}.jpg` };
          });

  if (!content) {
    return (
      <Card className="border-card-border">
        <CardContent
          className="p-6 text-sm text-muted-foreground"
          data-testid={`documentation-section-${entry.sectionId}-missing`}
        >
          Documentation copy for this section hasn't been written yet. (See{" "}
          <code className="font-mono">src/lib/docs/content.ts</code>.)
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="border-card-border"
      data-testid={`documentation-section-${entry.sectionId}`}
    >
      <CardContent className="p-6 space-y-6">
        <header>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            {entry.category}
          </p>
          <h2
            className="text-2xl font-semibold tracking-tight"
            data-testid={`documentation-heading-${entry.sectionId}`}
          >
            {content.heading}
          </h2>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            {content.intro}
          </p>
        </header>

        <figure
          className="rounded-md overflow-hidden border border-border bg-muted/40"
          data-testid={`documentation-screenshot-${entry.sectionId}`}
        >
          {screenshot ? (
            <img
              src={screenshot}
              alt={`Screenshot of ${content.heading} for the ${role ?? "current"} role`}
              loading="lazy"
              className="w-full h-auto block"
              data-testid={`documentation-screenshot-img-${entry.sectionId}`}
              onError={(e) => {
                // Fail silently — show the figcaption-as-placeholder
                // when the screenshot hasn't been captured yet.
                (e.currentTarget as HTMLImageElement).style.display = "none";
                const cap = (e.currentTarget.parentElement?.querySelector(
                  "[data-screenshot-fallback]",
                ) ?? null) as HTMLElement | null;
                if (cap) cap.style.display = "block";
              }}
            />
          ) : null}
          <figcaption
            data-screenshot-fallback
            style={{ display: screenshot ? "none" : "block" }}
            className="text-xs text-muted-foreground p-4 text-center"
          >
            No screenshot captured yet. Run{" "}
            <code className="font-mono">scripts/refresh-doc-screenshots.sh</code>{" "}
            to generate one.
          </figcaption>
        </figure>

        {extraScreenshots.map(({ key, src }) => (
          <figure
            key={key}
            className="rounded-md overflow-hidden border border-border bg-muted/40"
            data-testid={`documentation-screenshot-${key}`}
          >
            <img
              src={src}
              alt={`Additional screenshot (${key}) of ${content.heading} for the ${role ?? "current"} role`}
              loading="lazy"
              className="w-full h-auto block"
              data-testid={`documentation-screenshot-img-${key}`}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
                const cap = (e.currentTarget.parentElement?.querySelector(
                  "[data-screenshot-fallback]",
                ) ?? null) as HTMLElement | null;
                if (cap) cap.style.display = "block";
              }}
            />
            <figcaption
              data-screenshot-fallback
              style={{ display: "none" }}
              className="text-xs text-muted-foreground p-4 text-center"
            >
              No screenshot captured yet. Run{" "}
              <code className="font-mono">scripts/refresh-doc-screenshots.sh</code>{" "}
              to generate one.
            </figcaption>
          </figure>
        ))}

        <section>
          <h3 className="text-sm font-semibold mb-2">How to use it</h3>
          <ol
            className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground"
            data-testid={`documentation-walkthrough-${entry.sectionId}`}
          >
            {content.walkthrough.map((step, i) => (
              <li key={i} className="leading-relaxed">
                {step}
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h3 className="text-sm font-semibold mb-2">Fields & controls</h3>
          <dl
            className="space-y-2"
            data-testid={`documentation-fields-${entry.sectionId}`}
          >
            {content.fields.map((field) => (
              <div
                key={field.name}
                className="rounded-md border border-border bg-background/50 p-3"
              >
                <dt className="text-sm font-medium">{field.name}</dt>
                <dd className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  {field.description}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          className="rounded-md border border-border bg-muted/30 p-3"
          data-testid={`documentation-permissions-${entry.sectionId}`}
        >
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Permissions
          </h3>
          <p className="text-sm text-foreground">{permissionsNote(entry)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Route: <code className="font-mono">{entry.route}</code>
          </p>
        </section>
      </CardContent>
    </Card>
  );
}

// Re-export the matrix size for tests that need a stable count.
export const __DOCS_TOTAL_SECTIONS__ = DOCS_MATRIX.length;
