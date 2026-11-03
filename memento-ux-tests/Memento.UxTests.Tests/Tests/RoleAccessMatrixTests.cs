using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Auth;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    internal static class RouteAccess
    {
        public enum Outcome { Visible, Redirect, NotFound }

        public sealed record Row(
            string Route,
            Outcome MementoAdmin,
            Outcome Admin,
            Outcome LimitedAdmin,
            Outcome User);

        // Source of truth: mirrors App.tsx, AuthGate, and per-page guards.
        // Covers every REQUIREMENTS.md "Top-level pages" entry.
        //
        // Memento Admin is the god-mode role: every route Admin can
        // open, Memento Admin can open. /my-approvals also redirects
        // for Memento Admin because the MyApprovals useEffect bounces
        // every any-admin viewer (including Memento Admin) to
        // /admin/approval.
        //
        // /admin is the new top-level admin landing page that owns
        // Manage Projects / Users / Git Repos / Code changes / Fork
        // requests / Project assignments via collapsible sections. The
        // old per-section URLs (/tools/{approval,fork-requests,
        // project-assignments}, /admin/{manage-projects,users,
        // git-repos,approval,fork-requests,project-assignments},
        // /settings/{manage-projects,users,git-repos}) are now
        // RedirectTo routes that bounce to /admin#<section> — they
        // therefore count as Redirect for every role.
        public static readonly IReadOnlyList<Row> Matrix = new[]
        {
            new Row("/login",                     Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/splash",                    Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/profile/complete",          Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/profile",                   Outcome.Visible,  Outcome.Visible,  Outcome.Visible,  Outcome.Visible),
            // `/` is now the post-login Home (Dashboard) for signed-in
            // users; signed-out visitors see the public Landing.
            new Row("/",                          Outcome.Visible,  Outcome.Visible,  Outcome.Visible,  Outcome.Visible),
            // `/projects` is the Projects picker that used to live at `/`.
            new Row("/projects",                  Outcome.Visible,  Outcome.Visible,  Outcome.Visible,  Outcome.Visible),
            // `/dashboard` is a permanent redirect to `/`.
            new Row("/dashboard",                 Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/workbench",                 Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            // /settings now only owns Appearance (ALL_ROLES), Mocks
            // (anyAdmin) and SharedSteps — Appearance makes it
            // visible to every role including plain User.
            new Row("/settings",                  Outcome.Visible,  Outcome.Visible,  Outcome.Visible,  Outcome.Visible),
            new Row("/tools",                     Outcome.Visible,  Outcome.Visible,  Outcome.Visible,  Outcome.Redirect),
            // /admin owns the Source-control admin tools, including
            // the new "Repos PAT" section reached via the
            // /admin#repo-pats hash anchor. There is no separate
            // top-level route for Repos PAT, so the route-keyed matrix
            // covers it through this /admin row; the per-section
            // visibility (anyAdmin can open /admin, plain User is
            // bounced) is the same guarantee.
            new Row("/admin",                     Outcome.Visible,  Outcome.Visible,  Outcome.Visible,  Outcome.Redirect),
            // RedirectTo routes — they rewrite the URL to /admin
            // before the assertion runs, so every role sees them as a
            // redirect (even any-admin roles that *land* on /admin).
            new Row("/admin/manage-projects",     Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/admin/users",               Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/admin/git-repos",           Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/admin/approval",            Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/admin/fork-requests",       Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/admin/project-assignments", Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/tools/approval",            Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/tools/fork-requests",       Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/tools/project-assignments", Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/settings/manage-projects",  Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/settings/users",            Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/settings/git-repos",        Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/tools/validation-traces",   Outcome.Visible,  Outcome.Visible,  Outcome.Redirect, Outcome.Redirect),
            new Row("/tools/internal-tests",      Outcome.Visible,  Outcome.Visible,  Outcome.Redirect, Outcome.Redirect),
            new Row("/tools/test-runs",           Outcome.Visible,  Outcome.Visible,  Outcome.Visible,  Outcome.Redirect),
            // Activity is any-admin; Maintenance is full-Admin only.
            new Row("/tools/activity",            Outcome.Visible,  Outcome.Visible,  Outcome.Visible,  Outcome.Redirect),
            new Row("/tools/maintenance",         Outcome.Visible,  Outcome.Visible,  Outcome.Redirect, Outcome.Redirect),
            // Legacy /settings/<old> redirects added for the
            // Settings/Admin/Tools reorg. Architectures / Recording /
            // Validation bounce to /admin#section; Activity /
            // Maintenance bounce to /tools/<page>.
            new Row("/settings/architectures",    Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/settings/recording",        Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/settings/validation",       Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/settings/activity",         Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            new Row("/settings/maintenance",      Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Redirect),
            // /my-approvals: any-admin viewers (including Memento
            // Admin) are redirected to /admin/approval (MyApprovals
            // useEffect); only plain Users actually render the
            // submitter view.
            new Row("/my-approvals",              Outcome.Redirect, Outcome.Redirect, Outcome.Redirect, Outcome.Visible),
            new Row("/documentation",             Outcome.Visible,  Outcome.Visible,  Outcome.Visible,  Outcome.Visible),
            new Row("/documentation/home",        Outcome.Visible,  Outcome.Visible,  Outcome.Visible,  Outcome.Visible),
            new Row("/about",                     Outcome.Visible,  Outcome.Visible,  Outcome.Visible,  Outcome.Visible),
        };

        public static IEnumerable<TestCaseData> CasesFor(Outcome filter, Func<Row, Outcome> picker)
        {
            foreach (var r in Matrix)
            {
                if (picker(r) == filter)
                    yield return new TestCaseData(r.Route).SetName($"Route_{r.Route.Replace('/', '_')}_{filter}");
            }
        }

        public static IEnumerable<TestCaseData> MementoAdminVisible()  => CasesFor(Outcome.Visible,  r => r.MementoAdmin);
        public static IEnumerable<TestCaseData> MementoAdminRedirect() => CasesFor(Outcome.Redirect, r => r.MementoAdmin);
        public static IEnumerable<TestCaseData> AdminVisible()         => CasesFor(Outcome.Visible,  r => r.Admin);
        public static IEnumerable<TestCaseData> AdminRedirect()        => CasesFor(Outcome.Redirect, r => r.Admin);
        public static IEnumerable<TestCaseData> LimitedAdminVisible()  => CasesFor(Outcome.Visible,  r => r.LimitedAdmin);
        public static IEnumerable<TestCaseData> LimitedAdminRedirect() => CasesFor(Outcome.Redirect, r => r.LimitedAdmin);
        public static IEnumerable<TestCaseData> UserVisible()          => CasesFor(Outcome.Visible,  r => r.User);
        public static IEnumerable<TestCaseData> UserRedirect()         => CasesFor(Outcome.Redirect, r => r.User);

        // -----------------------------------------------------------------
        // Deep sub-routes (project pages, run details, tool detail pages).
        //
        // None of these paths are registered in App.tsx today, so wouter's
        // <Switch> falls through to the catch-all NotFound component.
        // AuthGate still applies — signed-in users land on a 404 card and
        // the URL is *not* rewritten, while signed-out users would be
        // bounced to /login. These rows lock that behavior in so a future
        // change that quietly adds a real route (with or without a role
        // guard) will fail the matrix and force an explicit decision.
        //
        // Limited-Admin scoping for /projects/:id is asserted twice: once
        // for an "assigned" project shape and once for an "unassigned"
        // shape. Both currently render the same NotFound page; if a real
        // /projects/:id route is added later, the unassigned row must be
        // updated to Outcome.Redirect to keep scope enforcement honest.
        public static readonly IReadOnlyList<Row> DeepMatrix = new[]
        {
            new Row("/projects/demo-project",                          Outcome.NotFound, Outcome.NotFound, Outcome.NotFound, Outcome.NotFound),
            new Row("/projects/unassigned-to-limited",                 Outcome.NotFound, Outcome.NotFound, Outcome.NotFound, Outcome.NotFound),
            new Row("/projects/demo-project/runs/run-123",             Outcome.NotFound, Outcome.NotFound, Outcome.NotFound, Outcome.NotFound),
            new Row("/tools/internal-tests/suite-id",                  Outcome.NotFound, Outcome.NotFound, Outcome.NotFound, Outcome.NotFound),
            new Row("/tools/validation-traces/trace-id",               Outcome.NotFound, Outcome.NotFound, Outcome.NotFound, Outcome.NotFound),
        };

        private static IEnumerable<TestCaseData> DeepCasesFor(Outcome filter, Func<Row, Outcome> picker)
        {
            foreach (var r in DeepMatrix)
            {
                if (picker(r) == filter)
                    yield return new TestCaseData(r.Route).SetName($"DeepRoute_{r.Route.Replace('/', '_')}_{filter}");
            }
        }

        public static IEnumerable<TestCaseData> MementoAdminDeepNotFound() => DeepCasesFor(Outcome.NotFound, r => r.MementoAdmin);
        public static IEnumerable<TestCaseData> AdminDeepNotFound()        => DeepCasesFor(Outcome.NotFound, r => r.Admin);
        public static IEnumerable<TestCaseData> LimitedAdminDeepNotFound() => DeepCasesFor(Outcome.NotFound, r => r.LimitedAdmin);
        public static IEnumerable<TestCaseData> UserDeepNotFound()         => DeepCasesFor(Outcome.NotFound, r => r.User);
    }

    internal static class RouteMatrixHelpers
    {
        private static string PathOf(string url)
        {
            var uri = new Uri(url);
            var p = uri.AbsolutePath.TrimEnd('/');
            return p.Length == 0 ? "/" : p;
        }

        private static string Normalize(string route)
        {
            var p = route.TrimEnd('/');
            return p.Length == 0 ? "/" : p;
        }

        // SPA redirects (AuthGate, Workbench's `useGetCurrentProject`
        // effect, MyApprovals' admin reroute, ...) update the URL via
        // wouter's history API after a React effect — sometimes after
        // an in-flight network call. Playwright's `WaitForURLAsync`
        // defaults to waiting for a fresh `Load` event after the URL
        // matches, which never fires for a pure history.replaceState,
        // so the helper would time out even when the redirect happened.
        // Polling `Page.Url` directly sidesteps both issues.
        private const int RedirectPollTimeoutMs = 10_000;
        private const int RedirectPollIntervalMs = 50;

        private static async Task<bool> PollForUrlAsync(
            IPage page, Func<string, bool> predicate, int timeoutMs)
        {
            var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < deadline)
            {
                if (predicate(PathOf(page.Url))) return true;
                await Task.Delay(RedirectPollIntervalMs);
            }
            return predicate(PathOf(page.Url));
        }

        public static async Task AssertVisibleAsync(IPage page, string route)
        {
            var target = Normalize(route);
            await page.GotoAsync(MementoSettings.BaseUrl + route);
            await PollForUrlAsync(page, p => p == target, RedirectPollTimeoutMs);
            PathOf(page.Url).Should().Be(target, $"role should be allowed on {route}");
        }

        public static async Task AssertRedirectAsync(IPage page, string route)
        {
            var target = Normalize(route);
            await page.GotoAsync(MementoSettings.BaseUrl + route);
            // Any path other than the requested target counts as a
            // redirect — including /login (signed-out reroute) and
            // /splash/home (signed-in reroute). The previous form
            // also OR-ed `p == "/login"`, which short-circuited the
            // wait when target itself was "/login" and let the
            // assertion fire before AuthGate could move the browser
            // off the login page.
            await PollForUrlAsync(page, p => p != target, RedirectPollTimeoutMs);
            PathOf(page.Url).Should().NotBe(
                target, $"role should NOT be allowed to view {route}");
        }

        public static async Task AssertNotFoundAsync(IPage page, string route)
        {
            var target = Normalize(route);
            await page.GotoAsync(MementoSettings.BaseUrl + route);
            // The 404 card is rendered by NotFound (`page-not-found`).
            // It must appear AND the URL must not have been rewritten —
            // a real route or a redirect would either change the path or
            // never render the 404.
            await page.GetByTestId("page-not-found")
                .WaitForAsync(new() { Timeout = 5000 });
            PathOf(page.Url).Should().Be(target,
                $"deep route {route} should stay on the URL and render the NotFound page");
            (await page.GetByTestId("page-not-found").CountAsync())
                .Should().Be(1,
                    $"deep route {route} must surface exactly one NotFound card");
        }
    }

    // -----------------------------------------------------------------
    // Per-role parameterized route matrix
    // -----------------------------------------------------------------

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class MementoAdminRouteMatrixTests : MementoAdminFixture
    {
        [TestCaseSource(typeof(RouteAccess), nameof(RouteAccess.MementoAdminVisible))]
        public async Task MementoAdmin_can_open(string route) =>
            await RouteMatrixHelpers.AssertVisibleAsync(Page, route);

        [TestCaseSource(typeof(RouteAccess), nameof(RouteAccess.MementoAdminRedirect))]
        public async Task MementoAdmin_is_redirected_from(string route) =>
            await RouteMatrixHelpers.AssertRedirectAsync(Page, route);
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class AdminRouteMatrixTests : AdminFixture
    {
        [TestCaseSource(typeof(RouteAccess), nameof(RouteAccess.AdminVisible))]
        public async Task Admin_can_open(string route) =>
            await RouteMatrixHelpers.AssertVisibleAsync(Page, route);

        [TestCaseSource(typeof(RouteAccess), nameof(RouteAccess.AdminRedirect))]
        public async Task Admin_is_redirected_from(string route) =>
            await RouteMatrixHelpers.AssertRedirectAsync(Page, route);
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class LimitedAdminRouteMatrixTests : LimitedAdminFixture
    {
        [TestCaseSource(typeof(RouteAccess), nameof(RouteAccess.LimitedAdminVisible))]
        public async Task LimitedAdmin_can_open(string route) =>
            await RouteMatrixHelpers.AssertVisibleAsync(Page, route);

        [TestCaseSource(typeof(RouteAccess), nameof(RouteAccess.LimitedAdminRedirect))]
        public async Task LimitedAdmin_is_redirected_from(string route) =>
            await RouteMatrixHelpers.AssertRedirectAsync(Page, route);
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class UserRouteMatrixTests : UserFixture
    {
        [TestCaseSource(typeof(RouteAccess), nameof(RouteAccess.UserVisible))]
        public async Task User_can_open(string route) =>
            await RouteMatrixHelpers.AssertVisibleAsync(Page, route);

        [TestCaseSource(typeof(RouteAccess), nameof(RouteAccess.UserRedirect))]
        public async Task User_is_redirected_from(string route) =>
            await RouteMatrixHelpers.AssertRedirectAsync(Page, route);
    }

    // -----------------------------------------------------------------
    // Home page exact tile/affordance sets per role
    // -----------------------------------------------------------------

    // Per-role home-tile contract. Test-ids reference HomeSelectors so
    // they stay aligned with admin-projects-home.tsx and limited-home.tsx.
    internal static class HomeTileExpectations
    {
        public static readonly string[] AdminMustAppear =
        {
            HomeSelectors.CardTryTheDemo,
        };
        public static readonly string[] AdminMustNotAppear =
        {
            HomeSelectors.ForkList,
        };

        public static readonly string[] LimitedAdminMustAppear =
        {
            HomeSelectors.CardTryTheDemo,
        };
        public static readonly string[] LimitedAdminMustNotAppear =
        {
            HomeSelectors.ButtonNewProject,
            HomeSelectors.ButtonAddProjectEmpty,
            HomeSelectors.ForkList,
        };

        public static readonly string[] UserMustAppear =
        {
            HomeSelectors.CardTryTheDemo,
        };
        public static readonly string[] UserMustNotAppear =
        {
            HomeSelectors.ButtonNewProject,
            HomeSelectors.ButtonAddProjectEmpty,
            HomeSelectors.ListProjects,
        };
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class AdminHomeAffordancesTests : AdminFixture
    {
        [Test]
        public async Task Admin_home_renders_exact_admin_tile_set()
        {
            foreach (var tid in HomeTileExpectations.AdminMustAppear)
                (await Page.GetByTestId(tid).CountAsync()).Should().BeGreaterThan(0,
                    $"Admin home must include {tid}");

            foreach (var tid in HomeTileExpectations.AdminMustNotAppear)
                (await Page.GetByTestId(tid).CountAsync()).Should().Be(0,
                    $"Admin home must NOT include {tid}");

            // Exactly one of list-projects / text-no-projects (XOR
            // contract from admin-projects-home.tsx).
            var home = new HomePage(Page);
            var hasList  = await home.ProjectListCountAsync() > 0;
            var hasEmpty = await home.EmptyStateCountAsync() > 0;
            hasList.Should().NotBe(hasEmpty,
                "exactly one of list-projects or text-no-projects renders");

            (await home.CreateProjectCtaCountAsync()).Should().Be(1,
                "full Admin must always see exactly one create-project CTA");
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class LimitedAdminHomeAffordancesTests : LimitedAdminFixture
    {
        [Test]
        public async Task LimitedAdmin_home_renders_exact_scoped_tile_set()
        {
            foreach (var tid in HomeTileExpectations.LimitedAdminMustAppear)
                (await Page.GetByTestId(tid).CountAsync()).Should().BeGreaterThan(0,
                    $"Limited Admin home must include {tid}");

            foreach (var tid in HomeTileExpectations.LimitedAdminMustNotAppear)
                (await Page.GetByTestId(tid).CountAsync()).Should().Be(0,
                    $"Limited Admin home must NOT include {tid}");

            var home = new HomePage(Page);
            (await home.CreateProjectCtaCountAsync()).Should().Be(0,
                "Limited Admin is not a full Admin and gets no create-project CTA");
        }

        [Test]
        public async Task LimitedAdmin_unassigned_project_rows_offer_request_or_pending_never_load()
        {
            // Scoped row contract: every row Limited Admin has no
            // access to must offer either Request access or a Pending
            // marker, and must never expose Load (which would let them
            // open a project outside their scope).
            var home = new HomePage(Page);
            var rows = home.NoAccessRows();
            var rowCount = await rows.CountAsync();
            rowCount.Should().BeGreaterThan(0,
                "Limited Admin fixture must surface at least one no-access row to prove the request/pending contract");

            for (int i = 0; i < rowCount; i++)
            {
                var row = rows.Nth(i);
                var hasRequest = await HomePage.RowHasRequestAccessAsync(row);
                var hasPending = await HomePage.RowHasPendingAsync(row);
                var hasLoad    = await HomePage.RowHasLoadAsync(row);

                hasLoad.Should().BeFalse(
                    "scoped Limited Admin must not see Load on rows they don't own");
                (hasRequest || hasPending).Should().BeTrue(
                    "every no-access row must expose Request access or a Pending marker");
            }
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class UserHomeAffordancesTests : UserFixture
    {
        [Test]
        public async Task User_home_renders_exact_fork_only_tile_set()
        {
            // Plain User goes through LimitedHome — fork-list shell,
            // no admin-home affordances anywhere on the page.
            foreach (var tid in HomeTileExpectations.UserMustAppear)
                (await Page.GetByTestId(tid).CountAsync()).Should().BeGreaterThan(0,
                    $"plain User home must include {tid}");

            foreach (var tid in HomeTileExpectations.UserMustNotAppear)
                (await Page.GetByTestId(tid).CountAsync()).Should().Be(0,
                    $"plain User home must NOT include {tid}");

            var home = new HomePage(Page);
            var hasForkList = await home.ForkListCountAsync() > 0;
            var hasEmpty    = await home.EmptyStateCountAsync() > 0;
            hasForkList.Should().NotBe(hasEmpty,
                "exactly one of list-fork-projects or text-no-projects renders");

            (await home.CreateProjectCtaCountAsync()).Should().Be(0);
            (await home.LoadButtonCountAsync()).Should().Be(0);
            (await home.DeleteButtonCountAsync()).Should().Be(0);
            (await home.NoAccessRows().CountAsync()).Should().Be(0,
                "row-no-access-* belongs to AdminProjectsHome only");
        }
    }

    // -----------------------------------------------------------------
    // Top-nav per role (positive + negative)
    // -----------------------------------------------------------------

    // Mirrors NAV_ITEMS in top-nav.tsx. Tools is the only adminOnly entry.
    internal static class TopNavExpectations
    {
        public static readonly string[] SharedLinks =
        {
            "Home", "Projects", "Workstation", "Settings", "Documentation", "About",
        };

        public static readonly string[] AdminOnlyLinks = { "Admin", "Tools" };
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class MementoAdminTopNavTests : MementoAdminFixture
    {
        [Test]
        public async Task MementoAdmin_top_nav_includes_tools_and_shared_links()
        {
            var nav = new TopNav(Page);
            foreach (var label in TopNavExpectations.AdminOnlyLinks)
                (await nav.IsNavLinkVisibleAsync(label)).Should().BeTrue(
                    $"{label} link should render for Memento Admin (god-mode superset of Admin)");
            foreach (var label in TopNavExpectations.SharedLinks)
                (await nav.IsNavLinkVisibleAsync(label)).Should().BeTrue(
                    $"{label} link should render for Memento Admin");
        }

        [Test]
        public async Task MementoAdmin_user_menu_shows_profile_tour_signout()
        {
            await new TopNav(Page).OpenUserMenuAsync();
            (await Page.GetByTestId(TopNavSelectors.MenuItemMyProfile).IsVisibleAsync()).Should().BeTrue();
            (await Page.GetByTestId(TopNavSelectors.MenuItemTakeTour).IsVisibleAsync()).Should().BeTrue();
            (await Page.GetByTestId(TopNavSelectors.ButtonSignOut).IsVisibleAsync()).Should().BeTrue();
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class AdminTopNavTests : AdminFixture
    {
        [Test]
        public async Task Admin_top_nav_includes_tools_and_shared_links()
        {
            var nav = new TopNav(Page);
            foreach (var label in TopNavExpectations.AdminOnlyLinks)
                (await nav.IsNavLinkVisibleAsync(label)).Should().BeTrue($"{label} link should render for Admin");
            foreach (var label in TopNavExpectations.SharedLinks)
                (await nav.IsNavLinkVisibleAsync(label)).Should().BeTrue($"{label} link should render for Admin");
        }

        [Test]
        public async Task Admin_user_menu_shows_profile_tour_signout()
        {
            await new TopNav(Page).OpenUserMenuAsync();
            (await Page.GetByTestId(TopNavSelectors.MenuItemMyProfile).IsVisibleAsync()).Should().BeTrue();
            (await Page.GetByTestId(TopNavSelectors.MenuItemTakeTour).IsVisibleAsync()).Should().BeTrue();
            (await Page.GetByTestId(TopNavSelectors.ButtonSignOut).IsVisibleAsync()).Should().BeTrue();
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class LimitedAdminTopNavTests : LimitedAdminFixture
    {
        [Test]
        public async Task LimitedAdmin_top_nav_includes_tools_and_shared_links()
        {
            var nav = new TopNav(Page);
            foreach (var label in TopNavExpectations.AdminOnlyLinks)
                (await nav.IsNavLinkVisibleAsync(label)).Should().BeTrue(
                    $"{label} link should render for Limited Admin (any-admin)");
            foreach (var label in TopNavExpectations.SharedLinks)
                (await nav.IsNavLinkVisibleAsync(label)).Should().BeTrue($"{label} link should render for Limited Admin");
        }

        [Test]
        public async Task LimitedAdmin_user_menu_shows_profile_tour_signout()
        {
            await new TopNav(Page).OpenUserMenuAsync();
            (await Page.GetByTestId(TopNavSelectors.MenuItemMyProfile).IsVisibleAsync()).Should().BeTrue();
            (await Page.GetByTestId(TopNavSelectors.MenuItemTakeTour).IsVisibleAsync()).Should().BeTrue();
            (await Page.GetByTestId(TopNavSelectors.ButtonSignOut).IsVisibleAsync()).Should().BeTrue();
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class UserTopNavTests : UserFixture
    {
        [Test]
        public async Task User_top_nav_hides_admin_only_links_and_keeps_shared_links()
        {
            var nav = new TopNav(Page);
            foreach (var label in TopNavExpectations.AdminOnlyLinks)
                (await nav.NavLinkCountAsync(label)).Should().Be(0,
                    $"{label} is admin-only and must NOT render for plain Users");
            foreach (var label in TopNavExpectations.SharedLinks)
                (await nav.IsNavLinkVisibleAsync(label)).Should().BeTrue(
                    $"{label} link should render for plain Users (page-level guards handle gating)");
        }

        [Test]
        public async Task User_user_menu_shows_profile_tour_signout_and_no_admin_links()
        {
            var nav = new TopNav(Page);
            await nav.OpenUserMenuAsync();
            (await Page.GetByTestId(TopNavSelectors.MenuItemMyProfile).IsVisibleAsync()).Should().BeTrue();
            (await Page.GetByTestId(TopNavSelectors.MenuItemTakeTour).IsVisibleAsync()).Should().BeTrue();
            (await Page.GetByTestId(TopNavSelectors.ButtonSignOut).IsVisibleAsync()).Should().BeTrue();
            // Belt-and-braces: no admin-only nav link leaks into the
            // user menu region for a plain User.
            foreach (var label in TopNavExpectations.AdminOnlyLinks)
                (await nav.NavLinkCountAsync(label)).Should().Be(0,
                    $"admin-only nav link '{label}' must not be reachable for plain User");
        }
    }

    // -----------------------------------------------------------------
    // Negative permission coverage for plain User
    // -----------------------------------------------------------------

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class UserNegativePermissionsTests : UserFixture
    {
        [Test]
        public async Task User_cannot_see_any_tools_admin_card()
        {
            await RouteMatrixHelpers.AssertRedirectAsync(Page, "/tools");
            // /tools redirects plain Users away, so no card should
            // render. Approval / Fork requests / Project assignments
            // have *moved* to /admin and no longer exist on /tools at
            // all — we still assert their absence as a regression
            // guard so a future re-introduction here lights up.
            var tools = new ToolsLandingPage(Page);
            (await tools.CardCountAsync(ToolsSelectors.CardApproval)).Should().Be(0);
            (await tools.CardCountAsync(ToolsSelectors.CardForkRequests)).Should().Be(0);
            (await tools.CardCountAsync(ToolsSelectors.CardProjectAssignments)).Should().Be(0);
            (await tools.CardCountAsync(ToolsSelectors.CardValidationTraces)).Should().Be(0);
            (await tools.CardCountAsync(ToolsSelectors.CardInternalTests)).Should().Be(0);
            (await tools.CardCountAsync(ToolsSelectors.CardTestRuns)).Should().Be(0);
        }

        [Test]
        public async Task User_cannot_open_admin_landing_page()
        {
            // /admin is gated to any-admin in admin.tsx — plain Users
            // get a toast + redirect to "/" and no admin section ever
            // renders for them.
            await RouteMatrixHelpers.AssertRedirectAsync(Page, "/admin");
            (await Page.GetByTestId(SettingsSelectors.SectionUsers).CountAsync()).Should().Be(0);
            (await Page.GetByTestId(SettingsSelectors.SectionManageProjects).CountAsync()).Should().Be(0);
            (await Page.GetByTestId(GitReposSelectors.SectionGitRepos).CountAsync()).Should().Be(0);
        }

        [Test]
        public async Task User_settings_shows_only_appearance()
        {
            // After the Settings/Admin/Tools reorg, /settings hosts
            // Appearance (ALL_ROLES), Mocks (anyAdmin) and SharedSteps.
            // A plain User can open the page but only sees Appearance —
            // every admin-gated section (Mocks plus all the moved ones)
            // must stay invisible.
            await RouteMatrixHelpers.AssertVisibleAsync(Page, "/settings");
            var settings = new SettingsPage(Page);
            (await settings.IsSectionVisibleAsync(SettingsSection.Appearance)).Should().BeTrue();
            (await settings.IsSectionVisibleAsync(SettingsSection.Mocks)).Should().BeFalse();
            (await settings.IsSectionVisibleAsync(SettingsSection.Architectures)).Should().BeFalse();
            (await settings.IsSectionVisibleAsync(SettingsSection.Recording)).Should().BeFalse();
            (await settings.IsSectionVisibleAsync(SettingsSection.Validation)).Should().BeFalse();
            (await settings.IsSectionVisibleAsync(SettingsSection.Maintenance)).Should().BeFalse();
            (await settings.IsSectionVisibleAsync(SettingsSection.Activity)).Should().BeFalse();
        }

        [Test]
        public async Task User_workbench_never_renders_file_edit_or_delete_affordances()
        {
            // /workbench redirects to "/" when no project is loaded,
            // and the file-edit toggle in code-viewer-panel.tsx is
            // wrapped in <AdminOnly>. Either way, neither button-edit-file
            // nor any per-row delete affordance must ever render for a User.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/workbench");
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            (await Page.GetByTestId("button-edit-file").CountAsync()).Should().Be(0);
            (await Page.Locator("[data-testid^=\"button-delete-\"]").CountAsync()).Should().Be(0);
        }
    }

    // -----------------------------------------------------------------
    // Positive permission coverage for Admin (full scope)
    // -----------------------------------------------------------------

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class AdminPositivePermissionsTests : AdminFixture
    {
        protected override string StartPath => "/settings";

        [Test]
        public async Task Admin_settings_renders_every_admin_only_section()
        {
            // After the Settings/Admin/Tools reorg, /settings owns
            // Appearance (ALL_ROLES), Mocks (anyAdmin) and SharedSteps.
            // Architectures / Recording / Validation moved to /admin
            // under the Behavior group and are asserted by
            // AdminPagePositivePermissionsTests; Activity / Maintenance
            // moved to /tools cards.
            var settings = new SettingsPage(Page);
            (await settings.IsSectionVisibleAsync(SettingsSection.Appearance)).Should().BeTrue();
            (await settings.IsSectionVisibleAsync(SettingsSection.Mocks)).Should().BeTrue();
            (await settings.IsSectionVisibleAsync(SettingsSection.Architectures)).Should().BeFalse();
            (await settings.IsSectionVisibleAsync(SettingsSection.Recording)).Should().BeFalse();
            (await settings.IsSectionVisibleAsync(SettingsSection.Validation)).Should().BeFalse();
            (await settings.IsSectionVisibleAsync(SettingsSection.Maintenance)).Should().BeFalse();
            (await settings.IsSectionVisibleAsync(SettingsSection.Activity)).Should().BeFalse();
        }
    }

    /// <summary>
    /// Positive coverage for the new top-level /admin page. Mirrors
    /// admin.tsx: six CollapsibleSections (Manage Projects, Users, Git
    /// Repos, Code changes/approval, Fork requests, Project
    /// assignments) — Git Repos and Project assignments are gated on
    /// full Admin.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class AdminPagePositivePermissionsTests : AdminFixture
    {
        protected override string StartPath => "/admin";

        [Test]
        public async Task Admin_page_renders_every_admin_section()
        {
            (await Page.GetByTestId(SettingsSelectors.SectionManageProjects).CountAsync())
                .Should().BeGreaterThan(0, "Manage Projects section must render for Admin on /admin");
            (await Page.GetByTestId(SettingsSelectors.SectionUsers).CountAsync())
                .Should().BeGreaterThan(0, "Users section must render for Admin on /admin");
            (await Page.GetByTestId(GitReposSelectors.SectionGitRepos).CountAsync())
                .Should().BeGreaterThan(0, "Git Repos section must render for Admin on /admin");
            (await Page.GetByTestId("settings-section-approval").CountAsync())
                .Should().BeGreaterThan(0, "Code changes section must render for Admin on /admin");
            (await Page.GetByTestId("settings-section-fork-requests").CountAsync())
                .Should().BeGreaterThan(0, "Fork requests section must render for Admin on /admin");
            (await Page.GetByTestId("settings-section-project-assignments").CountAsync())
                .Should().BeGreaterThan(0, "Project assignments section must render for Admin on /admin");
        }

        [TestCase("manage-projects", "/admin/manage-projects")]
        [TestCase("users",            "/admin/users")]
        [TestCase("git-repos",        "/admin/git-repos")]
        [TestCase("approval",         "/admin/approval")]
        [TestCase("fork-requests",    "/admin/fork-requests")]
        [TestCase("project-assignments", "/admin/project-assignments")]
        public async Task Admin_section_deep_link_redirects_to_admin_with_hash(
            string sectionTestId, string deepLink)
        {
            // /admin/<section> is wired to <RedirectTo to="/admin#section">
            // in App.tsx — the path rewrites to /admin and the section
            // wrapper renders.
            await Page.GotoAsync(MementoSettings.BaseUrl + deepLink);
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            new Uri(Page.Url).AbsolutePath.TrimEnd('/').Should().Be("/admin",
                $"{deepLink} should redirect to /admin");
            (await Page.GetByTestId($"settings-section-{sectionTestId}").CountAsync())
                .Should().BeGreaterThan(0,
                    $"the {sectionTestId} section wrapper must render after the redirect");
        }

        [TestCase("/tools/approval",            "approval")]
        [TestCase("/tools/fork-requests",       "fork-requests")]
        [TestCase("/tools/project-assignments", "project-assignments")]
        [TestCase("/settings/manage-projects",  "manage-projects")]
        [TestCase("/settings/users",            "users")]
        [TestCase("/settings/git-repos",        "git-repos")]
        [TestCase("/settings/architectures",    "architectures")]
        [TestCase("/settings/recording",        "recording")]
        [TestCase("/settings/validation",       "validation")]
        public async Task Legacy_admin_section_url_redirects_to_admin(
            string legacyUrl, string sectionTestId)
        {
            // Legacy /tools/* and /settings/* URLs for sections that
            // moved to /admin should bounce to /admin#<section>.
            await Page.GotoAsync(MementoSettings.BaseUrl + legacyUrl);
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            new Uri(Page.Url).AbsolutePath.TrimEnd('/').Should().Be("/admin",
                $"{legacyUrl} should redirect to /admin");
            (await Page.GetByTestId($"settings-section-{sectionTestId}").CountAsync())
                .Should().BeGreaterThan(0,
                    $"the {sectionTestId} section wrapper must render after legacy redirect");
        }

        [TestCase("/settings/activity",    "/tools/activity")]
        [TestCase("/settings/maintenance", "/tools/maintenance")]
        public async Task Legacy_settings_url_redirects_to_tools(
            string legacyUrl, string expectedPath)
        {
            // Activity / Maintenance moved out of /settings entirely
            // and now live as /tools cards. Their legacy /settings/*
            // URLs must bounce to the new /tools/<page> path.
            await Page.GotoAsync(MementoSettings.BaseUrl + legacyUrl);
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            new Uri(Page.Url).AbsolutePath.TrimEnd('/').Should().Be(expectedPath,
                $"{legacyUrl} should redirect to {expectedPath}");
        }
    }

    // -----------------------------------------------------------------
    // Negative permission coverage for Limited Admin
    // -----------------------------------------------------------------

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class LimitedAdminNegativePermissionsTests : LimitedAdminFixture
    {
        protected override string StartPath => "/settings";

        [Test]
        public async Task LimitedAdmin_admin_behavior_group_is_hidden()
        {
            // The Behavior group (Architectures / Recording /
            // Validation) on /admin is gated to full Admin only.
            // Limited Admin lands on /admin but must not see any of
            // those three sections.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin");
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            (await Page.GetByTestId(SettingsSelectors.SectionArchitectures).CountAsync()).Should().Be(0);
            (await Page.GetByTestId(SettingsSelectors.SectionRecording).CountAsync()).Should().Be(0);
            (await Page.GetByTestId(SettingsSelectors.SectionValidation).CountAsync()).Should().Be(0);
        }

        [Test]
        public async Task LimitedAdmin_users_section_is_read_only()
        {
            // Users now lives on /admin (not /settings).
            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin");
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            (await Page.GetByTestId(SettingsSelectors.SectionUsers).CountAsync())
                .Should().BeGreaterThan(0, "Users section must render for Limited Admin on /admin");
            (await Page.GetByTestId(SettingsSelectors.ButtonAddUser).CountAsync()).Should().Be(0);
            // No editable role-change <select>; only read-only badges.
            (await Page.Locator("[data-testid^=\"select-role-\"]").CountAsync()).Should().Be(0);
            (await Page.Locator("[data-testid^=\"text-role-\"]").CountAsync())
                .Should().BeGreaterThan(0);
        }

        [Test]
        public async Task LimitedAdmin_manage_projects_rows_have_no_per_row_delete()
        {
            // ManageProjectsSection on /admin is rendered with
            // canDelete={false} for Limited Admin. Per-row contract:
            // every project row visible inside the Manage Projects
            // section must NOT expose a button-delete-* affordance —
            // this is the row-level scope guard the reviewer asked for.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin");
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            (await Page.GetByTestId(SettingsSelectors.SectionManageProjects).CountAsync())
                .Should().BeGreaterThan(0, "Manage Projects section must render for Limited Admin on /admin");

            var section = Page.GetByTestId(SettingsSelectors.SectionManageProjects);
            var rows = section.Locator("[data-testid^=\"row-project-\"]");
            var rowCount = await rows.CountAsync();
            for (int i = 0; i < rowCount; i++)
            {
                (await rows.Nth(i).Locator("[data-testid^=\"button-delete-\"]").CountAsync())
                    .Should().Be(0,
                        $"row {i}: scoped Limited Admin must not see a per-row delete");
            }
            // Belt-and-braces: section-wide delete button count is also zero.
            (await section.Locator("[data-testid^=\"button-delete-\"]").CountAsync()).Should().Be(0);
        }

        [Test]
        public async Task LimitedAdmin_admin_page_hides_git_repos_and_project_assignments()
        {
            // Git Repos and Project assignments are gated on full
            // Admin in admin.tsx — Limited Admin reaches /admin but
            // those two sections must not render.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin");
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            (await Page.GetByTestId(GitReposSelectors.SectionGitRepos).CountAsync()).Should().Be(0);
            (await Page.GetByTestId("settings-section-project-assignments").CountAsync()).Should().Be(0);
            // Sections Limited Admin *does* get on /admin:
            (await Page.GetByTestId("settings-section-approval").CountAsync()).Should().BeGreaterThan(0);
            (await Page.GetByTestId("settings-section-fork-requests").CountAsync()).Should().BeGreaterThan(0);
        }

        [Test]
        public async Task LimitedAdmin_does_not_see_admin_only_tools_cards()
        {
            // Approval / Fork requests / Project assignments have all
            // moved to /admin and are no longer Tools cards at all.
            // Of the remaining Tools cards (test-runs, validation-traces,
            // internal-tests, ai-agent), only test-runs is visible to
            // Limited Admin.
            var tools = new ToolsLandingPage(Page);
            await tools.GotoAsync();
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            (await tools.CardCountAsync(ToolsSelectors.CardApproval)).Should().Be(0);
            (await tools.CardCountAsync(ToolsSelectors.CardForkRequests)).Should().Be(0);
            (await tools.CardCountAsync(ToolsSelectors.CardProjectAssignments)).Should().Be(0);
            (await tools.CardCountAsync(ToolsSelectors.CardInternalTests)).Should().Be(0);
            (await tools.CardCountAsync(ToolsSelectors.CardValidationTraces)).Should().Be(0);
            (await tools.IsCardVisibleAsync(ToolsSelectors.CardTestRuns)).Should().BeTrue();
        }

        [Test]
        public async Task LimitedAdmin_cannot_open_or_act_on_project_assignments()
        {
            // /admin/project-assignments redirects to /admin#…, and on
            // /admin the project-assignments section itself is gated
            // on isAdmin → it must not render for Limited Admin and
            // no project-assignments affordances must be reachable.
            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/project-assignments");
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            new Uri(Page.Url).AbsolutePath.TrimEnd('/').Should().Be("/admin",
                "Limited Admin should still land on /admin via the redirect");
            (await Page.GetByTestId("settings-section-project-assignments").CountAsync()).Should().Be(0);
            (await Page.GetByTestId(ToolsProjectAssignmentsSelectors.ButtonCreateAssignment)
                .CountAsync()).Should().Be(0);
            (await Page.GetByTestId(ToolsProjectAssignmentsSelectors.SectionAssignments)
                .CountAsync()).Should().Be(0);
        }
    }

    // -----------------------------------------------------------------
    // Positive scoped tests for Limited Admin
    // -----------------------------------------------------------------

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class LimitedAdminScopedPositiveTests : LimitedAdminFixture
    {
        protected override string StartPath => "/settings";

        [Test]
        public async Task LimitedAdmin_settings_shows_scoped_sections()
        {
            // After the Settings/Admin/Tools reorg, Activity moved to
            // /tools/activity (asserted by ToolsTests). The only
            // scoped /settings section left for Limited Admin is Mocks,
            // alongside the always-on Appearance section.
            var settings = new SettingsPage(Page);
            (await settings.IsSectionVisibleAsync(SettingsSection.Appearance)).Should().BeTrue();
            (await settings.IsSectionVisibleAsync(SettingsSection.Mocks)).Should().BeTrue();
        }

        [Test]
        public async Task LimitedAdmin_admin_page_shows_scoped_sections()
        {
            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin");
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            (await Page.GetByTestId(SettingsSelectors.SectionManageProjects).CountAsync())
                .Should().BeGreaterThan(0);
            (await Page.GetByTestId(SettingsSelectors.SectionUsers).CountAsync())
                .Should().BeGreaterThan(0);
            (await Page.GetByTestId("settings-section-approval").CountAsync())
                .Should().BeGreaterThan(0);
            (await Page.GetByTestId("settings-section-fork-requests").CountAsync())
                .Should().BeGreaterThan(0);
        }

        [Test]
        public async Task LimitedAdmin_can_open_scoped_approvals_queue()
        {
            // The approvals queue lives inside the /admin "approval"
            // section now. /admin/approval redirects to /admin#approval
            // and the section renders for Limited Admin (no isAdmin gate).
            await Page.GotoAsync(MementoSettings.BaseUrl + "/admin/approval");
            await Page.WaitForLoadStateAsync(LoadState.NetworkIdle);
            new Uri(Page.Url).AbsolutePath.TrimEnd('/').Should().Be("/admin");
            (await Page.GetByTestId("settings-section-approval").CountAsync())
                .Should().BeGreaterThan(0,
                    "Limited Admin must see the scoped Code-changes section on /admin");
        }

        [Test]
        public async Task LimitedAdmin_can_open_scoped_test_runs() =>
            await RouteMatrixHelpers.AssertVisibleAsync(Page, "/tools/test-runs");
    }

    // Sign-out parity tests for Limited Admin and User live in AuthTests.cs
    // (LimitedAdminSignOutTests, UserSignOutTests) to keep all sign-out
    // coverage in one canonical place.

    // -----------------------------------------------------------------
    // Deep sub-route coverage (project pages, run details, tool details)
    //
    // These fixtures hang off the same RouteAccess matrix as the
    // top-level coverage above so a future App.tsx route addition that
    // changes the role contract for any of these paths fails fast.
    // -----------------------------------------------------------------

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class MementoAdminDeepRouteMatrixTests : MementoAdminFixture
    {
        [TestCaseSource(typeof(RouteAccess), nameof(RouteAccess.MementoAdminDeepNotFound))]
        public async Task MementoAdmin_deep_route_renders_not_found(string route) =>
            await RouteMatrixHelpers.AssertNotFoundAsync(Page, route);
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class AdminDeepRouteMatrixTests : AdminFixture
    {
        [TestCaseSource(typeof(RouteAccess), nameof(RouteAccess.AdminDeepNotFound))]
        public async Task Admin_deep_route_renders_not_found(string route) =>
            await RouteMatrixHelpers.AssertNotFoundAsync(Page, route);
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class LimitedAdminDeepRouteMatrixTests : LimitedAdminFixture
    {
        [TestCaseSource(typeof(RouteAccess), nameof(RouteAccess.LimitedAdminDeepNotFound))]
        public async Task LimitedAdmin_deep_route_renders_not_found(string route) =>
            await RouteMatrixHelpers.AssertNotFoundAsync(Page, route);

        [Test]
        public async Task LimitedAdmin_project_page_behaves_the_same_for_assigned_and_unassigned_ids()
        {
            // Scope contract for /projects/:id. Today the route does not
            // exist, so both an assigned-style id and an unassigned-style
            // id render the catch-all NotFound page. The important
            // invariant is that an unassigned project id MUST NOT render
            // anything more permissive than the assigned-id baseline —
            // i.e. Limited Admin can never gain access to a project
            // outside their scope by typing a deep URL. When a real
            // /projects/:id route lands, this test should be split into
            // an "assigned -> Visible" assertion and an "unassigned ->
            // Redirect" assertion (and the DeepMatrix rows updated to
            // match) instead of being deleted.
            await RouteMatrixHelpers.AssertNotFoundAsync(Page, "/projects/demo-project");
            await RouteMatrixHelpers.AssertNotFoundAsync(Page, "/projects/unassigned-to-limited");
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class UserDeepRouteMatrixTests : UserFixture
    {
        [TestCaseSource(typeof(RouteAccess), nameof(RouteAccess.UserDeepNotFound))]
        public async Task User_deep_route_renders_not_found(string route) =>
            await RouteMatrixHelpers.AssertNotFoundAsync(Page, route);
    }
}
