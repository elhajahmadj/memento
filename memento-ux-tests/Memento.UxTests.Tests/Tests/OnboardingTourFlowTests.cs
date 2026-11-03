using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Api;
using Memento.UxTests.Infrastructure.Auth;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// Walks every step of the 5-step onboarding tour overlay:
    /// next, prev, finish — then asserts the
    /// <c>users.has_seen_tour</c> flag persists via the
    /// <c>/api/users/me/tour-state</c> endpoint that the React Query
    /// hook reads from. Also exercises the user-menu
    /// <c>menu-item-take-tour</c> entry that re-opens the overlay
    /// after dismissal (the Help relaunch path).
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class OnboardingTourFlowTests : AdminFixture
    {
        protected override string StartPath => "/";

        [Test]
        public async Task Walking_next_prev_finish_persists_has_seen_tour_true()
        {
            // Reset the per-user flag so the overlay auto-launches.
            await MementoApiClient.ForceTourSeenAsync(MementoRole.Admin, false);
            await Page.GotoAsync(MementoSettings.BaseUrl + "/");

            var overlay = Page.GetByTestId(OnboardingTourSelectors.Overlay);
            await overlay.WaitForAsync(new()
            {
                State = WaitForSelectorState.Visible,
                Timeout = 10_000,
            });

            // Step 1: Welcome. Prev must be disabled, Next visible.
            var prev = Page.GetByTestId(OnboardingTourSelectors.ButtonPrev);
            (await prev.IsDisabledAsync()).Should().BeTrue(
                "Prev must be disabled on the first step");

            // Walk forward through steps 2..4 (5 total — last step
            // shows Finish instead of Next).
            for (var i = 0; i < 4; i++)
            {
                var next = Page.GetByTestId(OnboardingTourSelectors.ButtonNext);
                await next.WaitForAsync(new() { Timeout = 5000 });
                await next.ClickAsync();
            }

            // On step 5 the Finish button replaces Next.
            var finish = Page.GetByTestId(OnboardingTourSelectors.ButtonFinish);
            await finish.WaitForAsync(new() { Timeout = 5000 });

            // Walk back once and forward once to prove Prev round-trips.
            await Page.GetByTestId(OnboardingTourSelectors.ButtonPrev)
                .ClickAsync();
            await Page.GetByTestId(OnboardingTourSelectors.ButtonNext)
                .WaitForAsync(new() { Timeout = 5000 });
            await Page.GetByTestId(OnboardingTourSelectors.ButtonNext)
                .ClickAsync();

            // Finish — the overlay disappears and the API persists the flag.
            await Page.GetByTestId(OnboardingTourSelectors.ButtonFinish)
                .ClickAsync();
            await overlay.WaitForAsync(new()
            {
                State = WaitForSelectorState.Hidden,
                Timeout = 10_000,
            });

            var state = await MementoApiClient.ReadTourStateAsync(MementoRole.Admin);
            state.HasSeenTour.Should().BeTrue(
                "completing the tour must persist hasSeenTour=true so it "
                + "never auto-launches again");
        }

        [Test]
        public async Task Close_button_persists_seen_flag_without_walking_steps()
        {
            await MementoApiClient.ForceTourSeenAsync(MementoRole.Admin, false);
            await Page.GotoAsync(MementoSettings.BaseUrl + "/");

            var overlay = Page.GetByTestId(OnboardingTourSelectors.Overlay);
            await overlay.WaitForAsync(new() { Timeout = 10_000 });

            await Page.GetByTestId(OnboardingTourSelectors.ButtonClose)
                .ClickAsync();
            await overlay.WaitForAsync(new()
            {
                State = WaitForSelectorState.Hidden,
                Timeout = 10_000,
            });

            var state = await MementoApiClient.ReadTourStateAsync(MementoRole.Admin);
            state.HasSeenTour.Should().BeTrue(
                "dismissing the overlay must also persist the flag — "
                + "otherwise it would re-launch on every page load");
        }

        [Test]
        public async Task Take_the_tour_user_menu_entry_re_opens_overlay_after_dismissal()
        {
            // Pre-condition: tour already seen so it does NOT auto-open.
            await MementoApiClient.ForceTourSeenAsync(MementoRole.Admin, true);
            await Page.GotoAsync(MementoSettings.BaseUrl + "/");

            // Overlay must NOT be present on a fresh load.
            (await Page.GetByTestId(OnboardingTourSelectors.Overlay).CountAsync())
                .Should().Be(0,
                    "tour overlay must stay hidden once hasSeenTour=true");

            // Open the user menu and click "Take the tour" — the
            // handler dispatches `onboarding:relaunch`, which the
            // overlay listens for to re-open at step 0.
            var nav = new TopNav(Page);
            await nav.OpenUserMenuAsync();
            await Page.GetByTestId(TopNavSelectors.MenuItemTakeTour)
                .ClickAsync();

            await Page.GetByTestId(OnboardingTourSelectors.Overlay)
                .WaitForAsync(new() { Timeout = 5000 });

            // The first step must render — proves the relaunch reset
            // the in-component step counter, not just the open flag.
            (await Page.GetByTestId(OnboardingTourSelectors.ButtonPrev)
                .IsDisabledAsync()).Should().BeTrue(
                    "relaunch must rewind the tour to step 1");

            // Close it back out so subsequent tests in this fixture
            // don't see a lingering overlay.
            await Page.GetByTestId(OnboardingTourSelectors.ButtonClose)
                .ClickAsync();
        }
    }
}
