using System;
using System.Linq;
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
    /// Network-mocks lifecycle test that goes one step further than
    /// <see cref="Tier3MocksUxTests"/>: in addition to add-via-dialog
    /// and toggle-enabled assertions, it queues a real validation run
    /// against the demo's <c>Demo_RunsAccessibilityAndApiChecks</c>
    /// method (which inlines a <c>routeMock</c> action targeting
    /// <c>**/api/users/me</c>) and proves the mock actually fires
    /// during the recorded run — the WebSocket event stream must
    /// emit <c>step-passed</c> for the routeMock-step's index, which
    /// is only reachable when the runtime arm in <c>replayService</c>
    /// installs and dispatches the <c>page.route()</c> rule.
    ///
    /// Falls back to <c>Assert.Inconclusive</c> when the demo project
    /// can't be scaffolded (no Chromium / no architecture seeded), per
    /// the suite's convention.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class NetworkMocksRecordingTests : AdminFixture
    {
        protected override string StartPath => "/settings";

        // The demo project (`MementoDemo`) seeds a Tier-3 test method
        // whose recorded actions include a routeMock for the URL below.
        // Both constants must stay in sync with
        // `features/demo/infrastructure/demoService.ts` so the runtime
        // hit assertion matches the URL the demo's recorded action
        // installs at replay.
        private const string DemoMockUrlPattern = "**/api/users/me";
        private const string DemoMockConsumingMethod =
            "Demo_RunsAccessibilityAndApiChecks";
        private const string DemoMockConsumingFile =
            "MementoDemo.Tests/DemoTests.cs";

        private MementoApiClient _api = null!;
        private string _projectName = string.Empty;
        private bool _haveDemo;

        protected override async Task OnRoleFixtureSetupAsync()
        {
            _api = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);
            try
            {
                var demo = await _api.EnsureDemoProjectAsync();
                _projectName = demo.SolutionName;
                _haveDemo = true;
                await _api.ClearRouteMocksAsync(_projectName);
            }
            catch
            {
                _haveDemo = false;
            }
            await Page.ReloadAsync();
        }

        protected override async Task OnTestFixtureTearDownAsync()
        {
            if (_haveDemo)
            {
                try { await _api.ClearRouteMocksAsync(_projectName); }
                catch { /* best-effort */ }
            }
            await _api.DisposeAsync();
        }

        private async Task ExpandMocksAsync()
        {
            var section = Page.GetByTestId(SettingsSelectors.SectionMocks);
            await section.WaitForAsync(new() { Timeout = 5000 });
            var addBtn = Page.GetByTestId(SettingsSelectors.ButtonAddMock);
            if (await addBtn.CountAsync() == 0) await section.ClickAsync();
            await addBtn.WaitForAsync(new() { Timeout = 5000 });
        }

        [Test]
        public async Task Add_mock_via_ui_then_toggle_enabled_then_run_fires_route_mock_event()
        {
            if (!_haveDemo)
            {
                Assert.Inconclusive(
                    "Demo project unavailable — cannot exercise the "
                    + "end-to-end mock-fires-during-run path without a "
                    + "loaded project.");
                return;
            }

            await ExpandMocksAsync();

            // 1) Add via UI. We deliberately use the demo's seeded URL
            // pattern so a) the persistent mock collides on the same
            // route the demo's inlined routeMock action also installs,
            // and b) the run we enqueue below is guaranteed to evaluate
            // a route-mock step against this exact pattern.
            var settings = new SettingsPage(Page);
            await settings.OpenAddMockAsync();
            await Page.GetByTestId(SettingsSelectors.DialogEditMock)
                .WaitForAsync(new() { Timeout = 5000 });

            await settings.FillMockAsync(
                name: "ux-mock-fires",
                method: "GET",
                url: DemoMockUrlPattern,
                status: 200,
                body: "{\"id\":\"ux-fires-1\",\"username\":\"ux\",\"role\":\"admin\"}");
            await settings.SaveMockAsync();

            await Page.GetByTestId(SettingsSelectors.DialogEditMock)
                .WaitForAsync(new()
                {
                    State = WaitForSelectorState.Hidden,
                    Timeout = 5000,
                });

            // Locate the row this test created (last added) so we can
            // toggle it off-then-on via the list switch.
            var rowsBefore = await _api.ListRouteMocksAsync(_projectName);
            var seeded = rowsBefore.Single(m => m.Name == "ux-mock-fires");

            // 2) Toggle disabled then re-enable through the list switch.
            var sw = Page.GetByTestId($"switch-mock-{seeded.Id}");
            await sw.WaitForAsync(new() { Timeout = 5000 });
            await sw.ClickAsync();
            var deadline = DateTime.UtcNow.AddSeconds(5);
            bool wentOff = false;
            while (DateTime.UtcNow < deadline)
            {
                var rows = await _api.ListRouteMocksAsync(_projectName);
                if (!rows.Single(x => x.Id == seeded.Id).Enabled)
                {
                    wentOff = true;
                    break;
                }
                await Task.Delay(150);
            }
            wentOff.Should().BeTrue(
                "switch-mock-{id} click must round-trip the enabled flag");

            await sw.ClickAsync();
            deadline = DateTime.UtcNow.AddSeconds(5);
            bool wentOn = false;
            while (DateTime.UtcNow < deadline)
            {
                var rows = await _api.ListRouteMocksAsync(_projectName);
                if (rows.Single(x => x.Id == seeded.Id).Enabled)
                {
                    wentOn = true;
                    break;
                }
                await Task.Delay(150);
            }
            wentOn.Should().BeTrue(
                "the mock must end the test re-enabled before we run");

            // 3) Sanity: the demo's seeded test-method list MUST contain
            // the routeMock-consuming method. If it doesn't, the demo
            // scaffolder has drifted from this test and we report it
            // rather than silently passing.
            var demo = await _api.EnsureDemoProjectAsync();
            demo.SeededTestMethods.Should().Contain(DemoMockConsumingMethod,
                "demo scaffolder is expected to seed the routeMock-"
                + "consuming method this fixture relies on");

            // Spot-check that the demo's source file actually inlines a
            // page.route() call for the URL we're about to assert on —
            // this guards against a codegen change that would silently
            // drop the routeMock step from the recorded test.
            var src = await _api.ReadProjectFileAsync(DemoMockConsumingFile);
            src.Should().Contain("api/users/me",
                "the demo's seeded test must wire up the routeMock the "
                + "fixture asserts on at runtime");

            // 4) Enqueue the run + collect events. Hard requirement:
            //   (a) The plan event includes a step with
            //       assertKind="route-mock" — this is the synthetic
            //       step replayService creates per routeMock action.
            //   (b) That step's index later appears in a step-passed
            //       event, which is only emitted after the runtime arm
            //       (replayService.ts:1110) installs the page.route()
            //       and the step body completes without throwing.
            // Together these prove the mock fires during the recorded
            // run — installation alone (mocks-installed event) is not
            // sufficient because that event fires for persistent mocks
            // even if the run never executes any of them.
            var runId = await _api.EnqueueValidationRunAsync(
                DemoMockConsumingFile, "method", DemoMockConsumingMethod);
            var events = await _api.CollectValidationEventsAsync(runId, 120_000);

            events.Should().NotBeEmpty(
                "the validation WS must produce at least one event "
                + "for an enqueued run");

            var planEvent = events.FirstOrDefault(e => e.Type == "plan");
            planEvent.Should().NotBeNull(
                "every run must emit exactly one plan event before "
                + "step execution begins");

            int? routeMockStepIndex = null;
            if (planEvent!.Raw.TryGetProperty("steps", out var stepsArr)
                && stepsArr.ValueKind == System.Text.Json.JsonValueKind.Array)
            {
                foreach (var step in stepsArr.EnumerateArray())
                {
                    var ak = step.TryGetProperty("assertKind", out var akEl)
                        && akEl.ValueKind == System.Text.Json.JsonValueKind.String
                        ? akEl.GetString() : null;
                    if (ak == "route-mock"
                        && step.TryGetProperty("index", out var idxEl)
                        && idxEl.ValueKind == System.Text.Json.JsonValueKind.Number)
                    {
                        routeMockStepIndex = idxEl.GetInt32();
                        break;
                    }
                }
            }
            routeMockStepIndex.Should().NotBeNull(
                "the demo's recorded test must contribute a step with "
                + "assertKind=\"route-mock\" to the run plan");

            events.Any(e => e.Type == "step-passed"
                    && e.Index == routeMockStepIndex)
                .Should().BeTrue(
                    "step-passed must fire for the routeMock step's "
                    + $"index ({routeMockStepIndex}) — that is the only "
                    + "indicator that the runtime arm installed the "
                    + "page.route() rule and let the step body complete "
                    + "without throwing");
        }
    }
}
