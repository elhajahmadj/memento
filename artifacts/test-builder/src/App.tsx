import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster as SonnerToaster } from "@/shared/ui/sonner";
import { TooltipProvider } from "@/shared/ui/tooltip";
import NotFound from "@/shared/pages/not-found";
import { Home } from "@/features/projects/presentation/pages/home";
import { Dashboard } from "@/features/dashboard/presentation/pages/dashboard";
import { Workbench } from "@/features/workbench/presentation/pages/workbench";
import { Settings } from "@/features/settings/presentation/pages/settings";
import { Tools } from "@/features/tools/presentation/pages/tools";
import { Admin } from "@/features/admin/presentation/pages/admin";
import { RedirectTo } from "@/features/admin/presentation/components/redirect-to";
import { ToolsValidationTraces } from "@/features/tools/presentation/pages/tools-validation-traces";
import { ToolsAiAgent } from "@/features/tools/presentation/pages/tools-ai-agent";
import { ToolsActivity } from "@/features/tools/presentation/pages/tools-activity";
import { ToolsMaintenance } from "@/features/tools/presentation/pages/tools-maintenance";
import { AiRunStatus } from "@/features/workbench/presentation/pages/ai-run-status";
import { ToolsInternalTests } from "@/features/tools/presentation/pages/tools-internal-tests";
import { ToolsTestRuns } from "@/features/tools/presentation/pages/tools-test-runs";
import { ToolsSelectionRun } from "@/features/tools/presentation/pages/tools-selection-run";
import { MyApprovals } from "@/features/approvals/presentation/pages/my-approvals";
import { Documentation } from "@/features/documentation/presentation/pages/documentation";
import { About } from "@/features/documentation/presentation/pages/about";
import { Privacy } from "@/features/documentation/presentation/pages/privacy";
import { Terms } from "@/features/documentation/presentation/pages/terms";
import { Login } from "@/features/auth/presentation/pages/login";
import { LoggedOut } from "@/features/auth/presentation/pages/logged-out";
import { Landing } from "@/features/auth/presentation/pages/landing";
import { PickOrg } from "@/features/auth/presentation/pages/pick-org";
import { Splash } from "@/features/auth/presentation/pages/splash";
import { ProfileComplete } from "@/features/auth/presentation/pages/profile-complete";
import { Profile } from "@/features/auth/presentation/pages/profile";
import { AuthProvider, useAuth } from "@/features/auth/presentation/auth-context";
import { useIsGuest } from "@/features/auth/presentation/role";
import { AuthGate } from "@/features/auth/presentation/auth-gate";
import { GuestBanner } from "@/features/auth/presentation/components/guest-banner";
import { guestBlocked } from "@/features/auth/presentation/guest-blocked-route";
import { ThemeProvider } from "@/shared/hooks/use-theme";
import { NavLayoutProvider } from "@/shared/hooks/use-nav-layout";
import { AppProviders } from "@/app/providers/AppProviders";

const queryClient = new QueryClient();

// Pages that are not part of the guest trial. A guest reaching one by
// deep link or bookmark is redirected to `/`.
//  - Profile: a placeholder on a throwaway identity, and both of its
//    tabs (profile edit, password reset) are closed server-side.
//  - Settings: only Appearance would be reachable.
//  - Documentation: not part of the trial.
const GuestBlockedProfile = guestBlocked(Profile);
const GuestBlockedSettings = guestBlocked(Settings);
const GuestBlockedDocumentation = guestBlocked(Documentation);

function Root() {
  const { user } = useAuth();
  const isGuest = useIsGuest();
  // Guests never see the dashboard: its widgets are built around
  // org health, admin queues, and run history a six-hour trial has
  // none of. Send them to the one page that matters to them instead
  // of rendering an empty shell.
  if (isGuest) return <RedirectTo to="/projects" />;
  return user ? <Dashboard /> : <Landing />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/logged-out" component={LoggedOut} />
      <Route path="/pick-org" component={PickOrg} />
      <Route path="/splash" component={Splash} />
      <Route path="/profile/complete" component={ProfileComplete} />
      <Route path="/profile" component={GuestBlockedProfile} />
      <Route path="/" component={Root} />
      <Route path="/projects" component={Home} />
      <Route path="/dashboard">
        <RedirectTo to="/" />
      </Route>
      <Route path="/workbench" component={Workbench} />
      <Route path="/settings" component={GuestBlockedSettings} />
      <Route path="/tools" component={Tools} />
      <Route path="/admin" component={Admin} />
      <Route path="/admin/manage-projects">
        <RedirectTo to="/admin#manage-projects" />
      </Route>
      <Route path="/admin/users">
        <RedirectTo to="/admin#users" />
      </Route>
      <Route path="/admin/git-repos">
        <RedirectTo to="/admin#git-repos" />
      </Route>
      <Route path="/admin/approval">
        <RedirectTo to="/admin#approval" />
      </Route>
      <Route path="/admin/fork-requests">
        <RedirectTo to="/admin#fork-requests" />
      </Route>
      <Route path="/admin/project-assignments">
        <RedirectTo to="/admin#project-assignments" />
      </Route>
      <Route path="/tools/approval">
        <RedirectTo to="/admin#approval" />
      </Route>
      <Route path="/tools/fork-requests">
        <RedirectTo to="/admin#fork-requests" />
      </Route>
      <Route path="/tools/project-assignments">
        <RedirectTo to="/admin#project-assignments" />
      </Route>
      <Route path="/settings/manage-projects">
        <RedirectTo to="/admin#manage-projects" />
      </Route>
      <Route path="/settings/users">
        <RedirectTo to="/admin#users" />
      </Route>
      <Route path="/settings/git-repos">
        <RedirectTo to="/admin#git-repos" />
      </Route>
      <Route path="/settings/architectures">
        <RedirectTo to="/admin#architectures" />
      </Route>
      <Route path="/settings/recording">
        <RedirectTo to="/admin#recording" />
      </Route>
      <Route path="/settings/validation">
        <RedirectTo to="/admin#validation" />
      </Route>
      <Route path="/settings/maintenance">
        <RedirectTo to="/tools/maintenance" />
      </Route>
      <Route path="/settings/activity">
        <RedirectTo to="/tools/activity" />
      </Route>
      <Route path="/tools/activity" component={ToolsActivity} />
      <Route path="/tools/maintenance" component={ToolsMaintenance} />
      <Route
        path="/tools/validation-traces"
        component={ToolsValidationTraces}
      />
      <Route path="/tools/ai-agent" component={ToolsAiAgent} />
      <Route
        path="/workbench/ai-runs/:projectName/:runId"
        component={AiRunStatus}
      />
      <Route path="/tools/internal-tests" component={ToolsInternalTests} />
      <Route path="/tools/test-runs" component={ToolsTestRuns} />
      <Route
        path="/tools/selection-runs/:projectId/:runId"
        component={ToolsSelectionRun}
      />
      <Route path="/my-approvals" component={MyApprovals} />
      <Route path="/documentation" component={GuestBlockedDocumentation} />
      <Route
        path="/documentation/:sectionId"
        component={GuestBlockedDocumentation}
      />
      <Route path="/about" component={About} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <AppProviders>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AuthProvider>
                <NavLayoutProvider>
                  {/*
                    App-level chrome, not page chrome: a guest's
                    countdown belongs above the nav and must survive
                    every route, including ones that don't use
                    PageShell. Renders null for every non-guest.
                  */}
                  <GuestBanner />
                  <AuthGate>
                    <Router />
                  </AuthGate>
                </NavLayoutProvider>
              </AuthProvider>
            </WouterRouter>
            <SonnerToaster richColors position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </AppProviders>
  );
}

export default App;
