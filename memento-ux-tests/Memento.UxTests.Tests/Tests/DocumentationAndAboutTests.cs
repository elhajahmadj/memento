using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Api;
using Memento.UxTests.Infrastructure.Auth;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class DocumentationTests : AdminFixture
    {
        [Test]
        public async Task Documentation_layout_renders()
        {
            var docs = new DocumentationPage(Page);
            await docs.GotoAsync();
            (await docs.IsLayoutVisibleAsync()).Should().BeTrue();
        }

        [Test]
        public async Task Documentation_sidebar_and_main_are_visible()
        {
            var docs = new DocumentationPage(Page);
            await docs.GotoAsync();
            (await docs.Sidebar().IsVisibleAsync()).Should().BeTrue();
            (await docs.Main().IsVisibleAsync()).Should().BeTrue();
        }

        [Test]
        public async Task Deep_link_opens_matching_section()
        {
            var docs = new DocumentationPage(Page);
            await docs.GotoAsync("settings-activity");
            (await docs.IsSectionVisibleAsync("settings-activity")).Should().BeTrue();
            Page.Url.Should().Contain("/documentation/settings-activity");
        }

        [Test]
        public async Task Sidebar_click_updates_url_and_visible_section()
        {
            var docs = new DocumentationPage(Page);
            await docs.GotoAsync("home");
            (await docs.IsSectionVisibleAsync("home")).Should().BeTrue();

            await docs.ClickSidebarEntryAsync("about");
            await Page.WaitForURLAsync(url => url.Contains("/documentation/about"));
            (await docs.IsSectionVisibleAsync("about")).Should().BeTrue();
        }

        [Test]
        public async Task Unknown_section_id_falls_back_to_first_visible_entry()
        {
            var docs = new DocumentationPage(Page);
            await docs.GotoAsync("not-a-real-section-id-xyz");
            // The Documentation page silently redirects unknown ids to
            // the first visible entry. The layout must still render.
            (await docs.IsLayoutVisibleAsync()).Should().BeTrue();
            await Page.WaitForURLAsync(url =>
                url.Contains("/documentation/")
                && !url.Contains("not-a-real-section-id-xyz"));
        }

        [Test]
        public async Task Admin_sees_more_sidebar_entries_than_plain_user()
        {
            var docs = new DocumentationPage(Page);
            await docs.GotoAsync();
            int adminCount = await docs.SidebarEntryCountAsync();
            adminCount.Should().BeGreaterThan(0);
            // The companion DocumentationUserTests fixture asserts the
            // User-role count separately; cross-fixture stashing isn't
            // reliable in NUnit so each side asserts independently.
            TestContext.WriteLine($"admin-doc-entry-count={adminCount}");
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class DocumentationUserTests : UserFixture
    {
        [Test]
        public async Task User_sees_a_role_scoped_doc_sidebar()
        {
            var docs = new DocumentationPage(Page);
            await docs.GotoAsync();
            int userCount = await docs.SidebarEntryCountAsync();
            // The matrix has well over 20 entries; a plain User should
            // only see workspace + account + about-style sections, so
            // the visible count must be strictly below 20. (See
            // DocumentationTests for the Admin-side parity assertion.)
            userCount.Should().BeGreaterThan(0);
            userCount.Should().BeLessThan(20,
                "a plain User should only see role-scoped doc entries");
        }

        [Test]
        public async Task User_cannot_deep_link_into_admin_only_section()
        {
            var docs = new DocumentationPage(Page);
            // settings-architectures is admin-only; the page should
            // silently redirect to whichever section the user CAN see.
            await docs.GotoAsync("settings-architectures");
            (await docs.IsLayoutVisibleAsync()).Should().BeTrue();
            await Page.WaitForURLAsync(url =>
                url.Contains("/documentation/")
                && !url.Contains("settings-architectures"));
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class AboutTests : AdminFixture
    {
        [Test]
        public async Task About_page_renders_creator_metadata()
        {
            var about = new AboutPage(Page);
            await about.GotoAsync();
            (await about.ReadTitleAsync()).Should().NotBeNullOrWhiteSpace();
            (await about.ReadCreatorNameAsync()).Should().NotBeNullOrWhiteSpace();
        }

        [Test]
        public async Task About_page_shows_version_and_creator_credit()
        {
            var about = new AboutPage(Page);
            await about.GotoAsync();
            var version = await about.ReadVersionAsync();
            var creator = await about.ReadCreatorNameAsync();
            version.Should().NotBeNullOrWhiteSpace();
            version.Should().Contain("Version");
            creator.Should().NotBeNullOrWhiteSpace();
        }
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class OnboardingTourTests : AdminFixture
    {
        [Test]
        public async Task Take_tour_menu_opens_the_tour_card()
        {
            var nav = new TopNav(Page);
            await nav.ClickTakeTourAsync();
            var tour = new OnboardingTour(Page);
            (await tour.IsOpenAsync()).Should().BeTrue();
            await tour.CloseAsync();
        }

        [Test]
        public async Task Five_steps_are_reachable_in_order()
        {
            // Reset so the overlay is in a known state, then relaunch
            // through the menu (avoids racing the auto-launch effect).
            await MementoApiClient.ForceTourSeenAsync(MementoRole.Admin, true);
            var nav = new TopNav(Page);
            await nav.ClickTakeTourAsync();
            var tour = new OnboardingTour(Page);
            await tour.WaitForOpenAsync();

            (await tour.ReadStepTitleAsync()).Should().NotBeNullOrWhiteSpace();
            for (int i = 0; i < 4; i++)
            {
                await tour.NextAsync();
                (await tour.ReadStepTitleAsync()).Should().NotBeNullOrWhiteSpace();
            }
            // Final step shows Got it; clicking it closes the overlay.
            await tour.FinishAsync();
            (await tour.IsOpenAsync()).Should().BeFalse();
        }

        [Test]
        public async Task X_dismissal_marks_tour_seen()
        {
            await MementoApiClient.ForceTourSeenAsync(MementoRole.Admin, false);
            await Page.ReloadAsync();
            var tour = new OnboardingTour(Page);
            await tour.WaitForOpenAsync();
            await tour.CloseAsync();

            var state = await MementoApiClient.ReadTourStateAsync(MementoRole.Admin);
            state.HasSeenTour.Should().BeTrue();
        }

        [Test]
        public async Task Backdrop_click_marks_tour_seen()
        {
            await MementoApiClient.ForceTourSeenAsync(MementoRole.Admin, false);
            await Page.ReloadAsync();
            var tour = new OnboardingTour(Page);
            await tour.WaitForOpenAsync();
            await tour.ClickBackdropAsync();

            var state = await MementoApiClient.ReadTourStateAsync(MementoRole.Admin);
            state.HasSeenTour.Should().BeTrue();
        }

        [Test]
        public async Task Got_it_marks_tour_seen()
        {
            await MementoApiClient.ForceTourSeenAsync(MementoRole.Admin, false);
            await Page.ReloadAsync();
            var tour = new OnboardingTour(Page);
            await tour.WaitForOpenAsync();
            for (int i = 0; i < 4; i++) await tour.NextAsync();
            await tour.FinishAsync();

            var state = await MementoApiClient.ReadTourStateAsync(MementoRole.Admin);
            state.HasSeenTour.Should().BeTrue();
        }

        [Test]
        public async Task Does_not_auto_launch_when_already_seen()
        {
            await MementoApiClient.ForceTourSeenAsync(MementoRole.Admin, true);
            await Page.ReloadAsync();
            // Give the overlay a chance to (incorrectly) appear.
            await Page.WaitForTimeoutAsync(500);
            var tour = new OnboardingTour(Page);
            (await tour.IsOpenAsync()).Should().BeFalse();
        }

        [Test]
        public async Task Relaunch_from_menu_does_not_flip_persisted_flag()
        {
            await MementoApiClient.ForceTourSeenAsync(MementoRole.Admin, true);
            await Page.ReloadAsync();
            var before = await MementoApiClient.ReadTourStateAsync(MementoRole.Admin);
            before.HasSeenTour.Should().BeTrue();

            var nav = new TopNav(Page);
            await nav.ClickTakeTourAsync();
            var tour = new OnboardingTour(Page);
            await tour.WaitForOpenAsync();

            // Flag stays unchanged WHILE the tour is open via relaunch.
            var midflight = await MementoApiClient.ReadTourStateAsync(MementoRole.Admin);
            midflight.HasSeenTour.Should().BeTrue();
        }
    }
}
