import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  Building2,
  FileEdit,
  FolderKanban,
  GaugeCircle,
  Heart,
  PlayCircle,
  Plug,
  ServerCog,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Skeleton } from "@/shared/ui/skeleton";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";
import { PageShell } from "@/shared/ui/shell/page-shell";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { formatDateTime as formatTime } from "@/shared/utils/format";

type DashboardWindow = "today" | "7d" | "30d";

const WINDOW_OPTIONS: ReadonlyArray<{ value: DashboardWindow; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

const WINDOW_GREETING: Record<DashboardWindow, string> = {
  today: "viewing today",
  "7d": "viewing last 7 days",
  "30d": "viewing last 30 days",
};

function isDashboardWindow(value: string): value is DashboardWindow {
  return value === "today" || value === "7d" || value === "30d";
}

function WindowPicker({
  value,
  onChange,
}: {
  value: DashboardWindow;
  onChange: (next: DashboardWindow) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next && isDashboardWindow(next)) onChange(next);
      }}
      variant="outline"
      size="sm"
      data-testid="dash-window-picker"
      aria-label="Dashboard time window"
    >
      {WINDOW_OPTIONS.map((opt) => (
        <ToggleGroupItem
          key={opt.value}
          value={opt.value}
          data-testid={`dash-window-${opt.value}`}
          aria-label={opt.label}
        >
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "passed"
      ? "default"
      : status === "failed" || status === "error"
        ? "destructive"
        : "secondary";
  return (
    <Badge variant={tone} data-testid={`dash-status-${status}`}>
      {status}
    </Badge>
  );
}

function Widget({
  title,
  testId,
  icon: Icon,
  children,
}: {
  title: string;
  testId: string;
  icon: React.ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <Card
      data-testid={testId}
      className="h-[260px] flex flex-col border-l-2 border-l-primary/40 transition-shadow hover:shadow-[var(--shadow-card-hover)]"
    >
      <CardHeader className="pb-2 flex flex-row items-center gap-2 space-y-0 h-12 shrink-0">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-brand-gradient-soft text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto">{children}</CardContent>
    </Card>
  );
}

const WIDGET_SKELETON_HEIGHT = "h-[260px]";

function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground italic">{children}</p>
  );
}

function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <PageShell
      showBack={false}
      contentClassName="max-w-6xl w-full"
      mainClassName="p-6 md:p-8"
    >
      {children}
    </PageShell>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const [window, setWindow] = useState<DashboardWindow>("7d");
  const { data, isLoading, isError, error } = useGetDashboardSummary({
    window,
  });

  if (isLoading) {
    return (
      <DashboardShell>
        <div data-testid="page-dashboard" className="space-y-6">
          <h1 className="text-2xl font-semibold" data-testid="dash-title">
            Dashboard
          </h1>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Skeleton className={WIDGET_SKELETON_HEIGHT} />
            <Skeleton className={WIDGET_SKELETON_HEIGHT} />
            <Skeleton className={WIDGET_SKELETON_HEIGHT} />
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (isError || !data) {
    return (
      <DashboardShell>
        <div data-testid="page-dashboard" className="space-y-6">
          <h1 className="text-2xl font-semibold" data-testid="dash-title">
            Dashboard
          </h1>
          <Alert variant="destructive" data-testid="dash-error">
            <AlertDescription>
              Couldn’t load the dashboard
              {error instanceof Error ? `: ${error.message}` : "."}
            </AlertDescription>
          </Alert>
        </div>
      </DashboardShell>
    );
  }

  const summary = data;
  const greeting = user?.firstName
    ? `Welcome back, ${user.firstName}`
    : "Welcome back";

  return (
    <DashboardShell>
      <div data-testid="page-dashboard" className="space-y-6">
        <header
          className="relative overflow-hidden rounded-xl border bg-brand-gradient-soft p-6 shadow-[var(--shadow-card)]"
        >
          <div className="absolute inset-y-0 left-0 w-1 bg-brand-gradient" aria-hidden />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-primary/80">
                Overview
              </p>
              <h1
                className="text-3xl font-semibold tracking-tight"
                data-testid="dash-title"
              >
                Dashboard
              </h1>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <WindowPicker value={window} onChange={setWindow} />
              <span
                className="text-sm text-muted-foreground"
                data-testid="dash-greeting"
              >
                {greeting} ·{" "}
                {isDashboardWindow(summary.window)
                  ? WINDOW_GREETING[summary.window]
                  : `viewing last ${summary.window}`}
              </span>
            </div>
          </div>
        </header>

        {summary.onboarding && (
          <Alert data-testid="dash-onboarding">
            <AlertDescription>
              <Link
                href={summary.onboarding.href}
                className="font-medium underline"
                data-testid="dash-onboarding-link"
              >
                {summary.onboarding.label} →
              </Link>
            </AlertDescription>
          </Alert>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Widget
            title="My recent runs"
            testId="widget-my-recent-runs"
            icon={PlayCircle}
          >
            {summary.myRecentRuns.length === 0 ? (
              <EmptyHint>No runs yet — kick one off from the Workbench.</EmptyHint>
            ) : (
              <ul className="space-y-2">
                {summary.myRecentRuns.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between text-sm"
                    data-testid="dash-recent-run-item"
                  >
                    <Link href={r.href} className="hover:underline truncate mr-2">
                      {r.projectName}
                    </Link>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={r.status} />
                      <span className="text-muted-foreground text-xs">
                        {formatTime(r.queuedAt)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Widget>

          <Widget
            title="My projects"
            testId="widget-my-projects"
            icon={FolderKanban}
          >
            {summary.myProjects.length === 0 ? (
              <EmptyHint>You haven’t worked in any projects yet.</EmptyHint>
            ) : (
              <ul className="space-y-2">
                {summary.myProjects.map((p) => (
                  <li
                    key={p.projectName}
                    className="text-sm"
                    data-testid="dash-project-item"
                  >
                    <Link href={p.href} className="hover:underline">
                      {p.projectName}
                    </Link>
                    {p.lastActivityAt && (
                      <span className="text-muted-foreground text-xs ml-2">
                        {formatTime(p.lastActivityAt)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Widget>

          <Widget
            title="Drafts in progress"
            testId="widget-drafts-in-progress"
            icon={FileEdit}
          >
            {summary.draftsInProgress.length === 0 ? (
              <EmptyHint>Nothing in flight.</EmptyHint>
            ) : (
              <ul className="space-y-2">
                {summary.draftsInProgress.map((d) => (
                  <li
                    key={d.id}
                    className="text-sm"
                    data-testid="dash-draft-item"
                  >
                    <Link href={d.href} className="hover:underline">
                      {d.title}
                    </Link>
                    <span className="text-muted-foreground text-xs ml-2">
                      {d.projectName}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Widget>

          {summary.adminProjectsCount !== null && (
            <Widget
              title="Projects I administer"
              testId="widget-admin-projects-count"
              icon={ShieldCheck}
            >
              <Link
                href="/projects"
                className="text-3xl font-bold text-brand-gradient hover:underline"
                data-testid="dash-admin-projects-value"
              >
                {summary.adminProjectsCount}
              </Link>
            </Widget>
          )}

          {summary.recentActivityInMyProjects && (
            <Widget
              title="Recent activity in my projects"
              testId="widget-recent-activity-in-my-projects"
              icon={Activity}
            >
              {summary.recentActivityInMyProjects.length === 0 ? (
                <EmptyHint>No recent activity.</EmptyHint>
              ) : (
                <ul className="space-y-2">
                  {summary.recentActivityInMyProjects.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <Link href={r.href} className="hover:underline truncate mr-2">
                        {r.projectName}
                      </Link>
                      <StatusBadge status={r.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Widget>
          )}

          {summary.orgHealth && (
            <Widget title="Org health" testId="widget-org-health" icon={Heart}>
              <Link href={summary.orgHealth.href} className="block hover:underline">
                <div className="text-3xl font-bold text-brand-gradient">
                  {summary.orgHealth.totalRuns === 0
                    ? "—"
                    : `${Math.round(summary.orgHealth.passRate * 100)}%`}
                </div>
                <div className="text-xs text-muted-foreground">
                  pass rate over {summary.orgHealth.totalRuns} runs
                </div>
              </Link>
            </Widget>
          )}

          {summary.failingTests && (
            <Widget
              title="Top failing tests"
              testId="widget-failing-tests"
              icon={AlertTriangle}
            >
              {summary.failingTests.length === 0 ? (
                <EmptyHint>No failures in the window 🎉</EmptyHint>
              ) : (
                <ul className="space-y-2">
                  {summary.failingTests.map((f, i) => (
                    <li
                      key={`${f.projectName}-${i}`}
                      className="flex items-center justify-between text-sm"
                      data-testid="dash-failing-item"
                    >
                      <Link href={f.href} className="hover:underline truncate mr-2">
                        {f.projectName}
                        {f.recordingFilePath ? ` · ${f.recordingFilePath}` : ""}
                      </Link>
                      <Badge variant="destructive">{f.failures}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Widget>
          )}

          {summary.users && (
            <Widget title="Users" testId="widget-users" icon={Users}>
              <Link
                href={summary.users.href}
                className="block hover:underline space-y-1"
              >
                <div>
                  <span className="text-3xl font-bold text-brand-gradient">
                    {summary.users.activeThisWeek}
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">
                    active this week
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  +{summary.users.newThisWindow} new in window
                </div>
              </Link>
            </Widget>
          )}

          {summary.projects && (
            <Widget title="Projects" testId="widget-projects" icon={FolderKanban}>
              <Link
                href={summary.projects.href}
                className="block hover:underline space-y-1"
              >
                <div>
                  <span className="text-3xl font-bold text-brand-gradient">
                    {summary.projects.total}
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">total</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {summary.projects.stale} stale (no runs in 30d)
                </div>
              </Link>
            </Widget>
          )}

          {summary.integrations && (
            <Widget title="Integrations" testId="widget-integrations" icon={Plug}>
              <div className="space-y-1 text-sm">
                <div>
                  <Link href={summary.integrations.usersHref} className="hover:underline">
                    SSO users:{" "}
                    <span className="font-semibold">{summary.integrations.ssoUsers}</span>
                  </Link>
                  <span className="text-muted-foreground ml-2">
                    · Local: {summary.integrations.localUsers}
                  </span>
                </div>
                <div>
                  <Link
                    href={summary.integrations.gitReposHref}
                    className="hover:underline"
                  >
                    Git repos with PAT:{" "}
                    <span className="font-semibold">
                      {summary.integrations.gitReposWithPat}
                    </span>
                  </Link>
                </div>
              </div>
            </Widget>
          )}

          {summary.orgs && (
            <Widget title="Organizations" testId="widget-orgs" icon={Building2}>
              <div className="text-3xl font-bold text-brand-gradient mb-2">
                {summary.orgs.total}
              </div>
              {summary.orgs.leaderboard.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {summary.orgs.leaderboard.map((o) => (
                    <li
                      key={o.organizationId}
                      className="flex justify-between"
                      data-testid="dash-org-leader-item"
                    >
                      <Link href={o.href} className="hover:underline truncate mr-2">
                        {o.displayName}
                      </Link>
                      <span className="text-muted-foreground">{o.runs} runs</span>
                    </li>
                  ))}
                </ul>
              )}
            </Widget>
          )}

          {summary.systemHealth && (
            <Widget
              title="System health"
              testId="widget-system-health"
              icon={ServerCog}
            >
              <Link
                href={summary.systemHealth.href}
                className="block hover:underline space-y-1"
              >
                <div className="text-sm">
                  Admin actions (24h):{" "}
                  <span className="font-semibold">
                    {summary.systemHealth.recentAdminActions}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <GaugeCircle className="h-3 w-3" />
                  API error rate:{" "}
                  {summary.systemHealth.apiErrorRate === null
                    ? "—"
                    : `${(summary.systemHealth.apiErrorRate * 100).toFixed(2)}%`}
                </div>
              </Link>
            </Widget>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
