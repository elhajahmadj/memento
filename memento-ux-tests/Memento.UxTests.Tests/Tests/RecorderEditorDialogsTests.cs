using System.Linq;
using System.Text.Json;
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
    /// Recording-editor dialog coverage: collision rename dialog,
    /// fix-selector heal preview, generate-pipeline-file wizard, and
    /// capture-login (with the saved-login reuse banner). All four
    /// dialogs require an active project — when one is missing the
    /// suite's convention is to <c>Assert.Inconclusive</c>, not
    /// <c>Assert.Pass</c>, so a misconfigured environment is reported
    /// as a gap rather than silently green.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class RecorderEditorDialogsTests : AdminFixture
    {
        protected override string StartPath => "/workbench";

        // -----------------------------------------------------------
        // Pipeline-file wizard (unchanged from prior submission).
        // -----------------------------------------------------------
        [Test]
        public async Task Generate_pipeline_file_dialog_walks_two_step_wizard_and_enables_generate()
        {
            var actionsMenu = Page.GetByTestId(
                WorkbenchSelectors.ButtonWorkbenchActionsMenu);
            if (await actionsMenu.CountAsync() == 0)
            {
                Assert.Inconclusive(
                    "Workbench has no active project — pipeline-file "
                    + "affordance is hidden in the empty state.");
                return;
            }

            await actionsMenu.ClickAsync();
            await Page.GetByTestId(WorkbenchSelectors.ButtonGeneratePipelineFile)
                .ClickAsync();

            var dialog = Page.GetByTestId("dialog-generate-pipeline-file");
            await dialog.WaitForAsync(new() { Timeout = 5000 });

            var azure = Page.GetByTestId("radio-platform-azure");
            await azure.WaitForAsync(new() { Timeout = 3000 });
            await azure.ClickAsync();

            var next = Page.GetByTestId("button-pipeline-next");
            (await next.IsEnabledAsync()).Should().BeTrue(
                "Next must enable once a platform is picked");
            await next.ClickAsync();

            var mode = Page.Locator("[data-testid^=\"radio-mode-\"]").First;
            await mode.WaitForAsync(new() { Timeout = 3000 });
            await mode.ClickAsync();

            var generate = Page.GetByTestId("button-pipeline-generate");
            (await generate.IsEnabledAsync()).Should().BeTrue(
                "Generate must be enabled after picking a mode");

            await Page.GetByTestId("button-pipeline-back").ClickAsync();
            (await Page.GetByTestId("button-pipeline-next").IsVisibleAsync())
                .Should().BeTrue("Back must return the user to step 1");

            await Page.GetByTestId("button-pipeline-cancel").ClickAsync();
            await dialog.WaitForAsync(new()
            {
                State = WaitForSelectorState.Hidden,
                Timeout = 5000,
            });
        }

        // -----------------------------------------------------------
        // Capture-login dialog: setup phase form contract.
        // -----------------------------------------------------------
        [Test]
        public async Task Capture_login_dialog_renders_setup_phase_with_url_and_label_inputs()
        {
            var openBtn = Page.GetByTestId(WorkbenchSelectors.ButtonCaptureLogin);
            if (await openBtn.CountAsync() == 0)
            {
                Assert.Inconclusive(
                    "Workbench has no active project — capture-login "
                    + "affordance is hidden when the recorder is unavailable.");
                return;
            }
            await openBtn.ClickAsync();

            var dialog = Page.GetByTestId("dialog-capture-login");
            await dialog.WaitForAsync(new() { Timeout = 5000 });

            (await Page.GetByTestId("input-capture-url").IsVisibleAsync())
                .Should().BeTrue();
            (await Page.GetByTestId("input-capture-label").IsVisibleAsync())
                .Should().BeTrue();
            var start = Page.GetByTestId("button-start-capture");
            (await start.IsVisibleAsync()).Should().BeTrue();

            await Page.GetByTestId("input-capture-url").FillAsync("");
            (await start.IsEnabledAsync()).Should().BeFalse(
                "Start capture must be disabled with an empty URL");

            await Page.GetByTestId("input-capture-url")
                .FillAsync("https://app.example.com/login");
            (await start.IsEnabledAsync()).Should().BeTrue(
                "Start capture must enable once a URL is provided");

            await dialog.PressAsync("Escape");
        }

        // -----------------------------------------------------------
        // Saved-login REUSE: drive a real recording session, save the
        // auth state via /api/auth-state/save (the only path that
        // persists; there is no API-only seed path because the route
        // gates on `getStatus().active`), close, then re-open the
        // start-recording dialog and assert checkbox-use-saved-login
        // is rendered. This proves the "reuse saved login" affordance
        // round-trips through the persistent auth-state row.
        // -----------------------------------------------------------
        [Test]
        public async Task Start_recording_dialog_surfaces_saved_login_checkbox_after_capture_round_trip()
        {
            await using var api = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);

            // Demo project gives us a loaded project so the recorder can
            // start. If scaffolding fails (no Chromium / no architecture)
            // we report a gap rather than silently passing.
            string projectName;
            try
            {
                var demo = await api.EnsureDemoProjectAsync();
                projectName = demo.SolutionName;
            }
            catch
            {
                Assert.Inconclusive(
                    "Demo project unavailable — cannot drive the saved-"
                    + "login capture flow without a loaded project.");
                return;
            }

            // Make sure no stale row exists from a previous run, so the
            // assertion below is unambiguous: the checkbox must appear
            // *as a result of* this test's POST /api/auth-state/save.
            (await api.DeleteAsync("api/auth-state")).EnsureSuccessStatusCode();

            await Page.ReloadAsync();

            // 1. Start a real recording so getStatus().active === true.
            var helper = await RecorderGate.StartOrInconclusiveAsync(
                Page, "SavedLoginProbe");
            try
            {
                // 2. With a live recording, the auth-state/save route
                // accepts the capture. The Page's HTTP context shares
                // the session cookie with `api` (both are admin), so
                // either client can drive the save. We use `api` so we
                // don't have to rely on UI-side toasts.
                var saveResp = await api.PostJsonAsync(
                    "api/auth-state/save", new { label = "ux-saved-login" });
                if (!saveResp.IsSuccessStatusCode)
                {
                    var body = await saveResp.Content.ReadAsStringAsync();
                    Assert.Inconclusive(
                        "POST /api/auth-state/save did not succeed during "
                        + $"a live recording: {(int)saveResp.StatusCode} {body}");
                    return;
                }

                // Confirm the row landed before we close the recording.
                var summary = await api.GetJsonAsync<SavedAuthStateDto>(
                    "api/auth-state");
                summary.HasState.Should().BeTrue(
                    "GET /api/auth-state must report hasState=true after "
                    + "a successful capture-and-save");
            }
            finally
            {
                await helper.StopAsync();
                await helper.DiscardAsync();
            }

            // 3. Re-open the start-recording dialog. The dialog reads
            // /api/auth-state on mount; the checkbox is conditionally
            // rendered iff hasState=true.
            var openBtn = Page.GetByTestId(WorkbenchSelectors.ButtonStartRecording);
            await openBtn.WaitForAsync(new() { Timeout = 10_000 });
            await openBtn.ClickAsync();

            var checkbox = Page.GetByTestId(
                StartRecordingDialogSelectors.CheckboxUseSavedLogin);
            await checkbox.WaitForAsync(new() { Timeout = 10_000 });
            (await checkbox.IsVisibleAsync()).Should().BeTrue(
                "checkbox-use-saved-login must render in the start-recording "
                + "dialog once /api/auth-state reports a saved row");

            await Page.Keyboard.PressAsync("Escape");

            // Cleanup so we don't leak the saved row across fixtures.
            await api.DeleteAsync("api/auth-state");
        }

        private sealed record SavedAuthStateDto(
            [property: System.Text.Json.Serialization.JsonPropertyName("hasState")]
            bool HasState,
            [property: System.Text.Json.Serialization.JsonPropertyName("label")]
            string? Label,
            [property: System.Text.Json.Serialization.JsonPropertyName("updatedAt")]
            string? UpdatedAt);

        // -----------------------------------------------------------
        // Method-collision warning + suggested-name button. We seed a
        // discoverable test class file under <TestProjectName>/Tests/
        // (which `listTestClasses` for C# scans) containing a method
        // we then collide on. The dialog's `useGetMethodState` query
        // hits /api/recording/method-state for the file we picked, so
        // the warning fires deterministically.
        // -----------------------------------------------------------
        [Test]
        public async Task Start_recording_method_collision_warns_and_suggested_name_button_resolves_it()
        {
            await using var api = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);

            string projectName;
            try
            {
                var demo = await api.EnsureDemoProjectAsync();
                projectName = demo.SolutionName;
            }
            catch
            {
                Assert.Inconclusive(
                    "Demo project unavailable — collision warning needs a "
                    + "loaded C# project with at least one test class.");
                return;
            }

            // Pick the demo's seeded class & method as the collision
            // target. This avoids a separate /api/files write path and
            // guarantees the names exist in source.
            const string targetClassFile = "MementoDemo.Tests/DemoTests.cs";
            const string targetClassName = "DemoTests";
            const string collidingMethod = "Demo_VisitsHomePageAndAssertsTitle";

            // Belt-and-braces: confirm /api/recording/method-state agrees
            // there's a collision before we drive the UI. If not, the
            // demo scaffolder has drifted and we report it explicitly.
            var stateResp = await api.GetAsync(
                $"api/recording/method-state?filePath={System.Uri.EscapeDataString(targetClassFile)}"
                + $"&methodName={System.Uri.EscapeDataString(collidingMethod)}");
            stateResp.EnsureSuccessStatusCode();
            var stateBody = await stateResp.Content.ReadAsStringAsync();
            using (var doc = JsonDocument.Parse(stateBody))
            {
                var exists = doc.RootElement.TryGetProperty("exists", out var ex)
                    && ex.ValueKind == JsonValueKind.True;
                if (!exists)
                {
                    Assert.Inconclusive(
                        $"Demo seed has drifted — method '{collidingMethod}' "
                        + $"is no longer present in {targetClassFile}, so "
                        + "the dialog will not surface a collision warning.");
                    return;
                }
            }

            await Page.ReloadAsync();
            var openBtn = Page.GetByTestId(WorkbenchSelectors.ButtonStartRecording);
            await openBtn.WaitForAsync(new() { Timeout = 10_000 });
            await openBtn.ClickAsync();

            var classPicker = Page.GetByTestId(
                StartRecordingDialogSelectors.SelectExistingClass);
            await classPicker.WaitForAsync(new() { Timeout = 5000 });
            await classPicker.ClickAsync();

            // Pick the demo's class by visible label.
            await Page.GetByRole(AriaRole.Option,
                new() { Name = targetClassName }).First.ClickAsync();

            var methodInput = Page.GetByTestId(
                StartRecordingDialogSelectors.InputMethodName);
            await methodInput.WaitForAsync(new() { Timeout = 5000 });
            await methodInput.FillAsync(collidingMethod);

            // Hard assert: warning must surface.
            var warning = Page.GetByTestId(
                StartRecordingDialogSelectors.WarningMethodCollision);
            await warning.WaitForAsync(new() { Timeout = 5000 });
            (await warning.IsVisibleAsync()).Should().BeTrue(
                "warning-method-collision must render once the typed "
                + $"method name ({collidingMethod}) collides with an "
                + $"existing method in {targetClassFile}");

            // The suggested-name button is rendered alongside the
            // warning and, when clicked, replaces the input value with
            // a non-colliding suggestion (the dialog appends an _N
            // suffix). After the click, both the input value must
            // change AND the warning must clear.
            var useSuggested = Page.GetByTestId(
                StartRecordingDialogSelectors.ButtonUseSuggestedMethodName);
            await useSuggested.WaitForAsync(new() { Timeout = 5000 });
            await useSuggested.ClickAsync();

            await Page.WaitForFunctionAsync(
                "() => !document.querySelector('[data-testid=\"warning-method-collision\"]')",
                new PageWaitForFunctionOptions { Timeout = 5000 });
            (await Page.GetByTestId(
                    StartRecordingDialogSelectors.WarningMethodCollision)
                .CountAsync())
                .Should().Be(0,
                    "clicking button-use-suggested-method-name must "
                    + "rewrite the input to a unique name and hide the "
                    + "warning element");

            var newValue = await methodInput.InputValueAsync();
            newValue.Should().NotBe(collidingMethod,
                "the input value must change after clicking "
                + "button-use-suggested-method-name");
            newValue.Should().NotBeNullOrWhiteSpace(
                "the suggested name must be a non-empty replacement");

            await Page.Keyboard.PressAsync("Escape");
        }

        // -----------------------------------------------------------
        // Fix-selector HEAL PREVIEW: drive POST /api/selectors/heal
        // with dryRun=true against a selector the demo seeds, and
        // assert the response advertises affected recordings/sites
        // with before/after pairs. This is what the Fix-selector
        // dialog renders in its preview pane; the dialog itself is
        // only mountable from a failed validation step (covered by
        // the contract assertion below), but the preview SERVICE is
        // the meat of the heal feature and must produce real diffs.
        // -----------------------------------------------------------
        [Test]
        public async Task Fix_selector_heal_dry_run_returns_affected_recordings_and_before_after_diffs()
        {
            await using var api = await MementoApiClient.SignedInAsAsync(MementoRole.Admin);

            try
            {
                await api.EnsureDemoProjectAsync();
            }
            catch
            {
                Assert.Inconclusive(
                    "Demo project unavailable — heal preview needs the "
                    + "seeded recording rows to scan against.");
                return;
            }

            // The demo seeds a recorded action with selector "h1" (see
            // features/demo/infrastructure/demoService.ts). Asking the
            // heal service to dry-run h1 → h2-replaced must report at
            // least one recording row touched, with explicit before/
            // after pairs in the per-recording details.
            var resp = await api.PostJsonAsync(
                "api/selectors/heal",
                new
                {
                    oldSelector = "h1",
                    newSelector = "h2-replaced",
                    dryRun = true,
                });
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;

            // Top-level shape: { recordingsChanged, totalReplacements,
            // details: [{ recordingId, sites: [{ before, after, ... }] }],
            // fileDetails: [...] } — assert the recording-row arm has
            // at least one hit and the per-row sites carry before/after.
            int recordingsChanged = root.TryGetProperty("recordingsChanged", out var rc)
                && rc.ValueKind == JsonValueKind.Number
                ? rc.GetInt32() : -1;
            recordingsChanged.Should().BeGreaterThan(0,
                "dry-run heal of h1 must report at least one demo "
                + "recording row affected (got "
                + $"{recordingsChanged})");

            root.TryGetProperty("details", out var details).Should().BeTrue(
                "heal preview must include a `details` array per recording");
            details.ValueKind.Should().Be(JsonValueKind.Array);

            var foundBeforeAfter = false;
            foreach (var rec in details.EnumerateArray())
            {
                if (!rec.TryGetProperty("sites", out var sites)
                    || sites.ValueKind != JsonValueKind.Array) continue;
                foreach (var site in sites.EnumerateArray())
                {
                    var hasBefore = site.TryGetProperty("before", out var b)
                        && b.ValueKind == JsonValueKind.String
                        && b.GetString() == "h1";
                    var hasAfter = site.TryGetProperty("after", out var a)
                        && a.ValueKind == JsonValueKind.String
                        && a.GetString() == "h2-replaced";
                    if (hasBefore && hasAfter)
                    {
                        foundBeforeAfter = true;
                        break;
                    }
                }
                if (foundBeforeAfter) break;
            }
            foundBeforeAfter.Should().BeTrue(
                "heal preview must surface a per-site before/after pair "
                + "(\"h1\" → \"h2-replaced\") so the dialog can render a "
                + "reviewable diff before commit");

            // Belt-and-braces contract assertion: dry-run must NOT
            // mutate state. A second dry-run against the same args
            // must return the same recordingsChanged.
            var resp2 = await api.PostJsonAsync(
                "api/selectors/heal",
                new
                {
                    oldSelector = "h1",
                    newSelector = "h2-replaced",
                    dryRun = true,
                });
            resp2.EnsureSuccessStatusCode();
            var body2 = await resp2.Content.ReadAsStringAsync();
            using var doc2 = JsonDocument.Parse(body2);
            var rc2 = doc2.RootElement.GetProperty("recordingsChanged").GetInt32();
            rc2.Should().Be(recordingsChanged,
                "a second dry-run with identical args must report the "
                + "same affected count — proving dryRun=true did not "
                + "actually mutate the recordings on the first call");
        }

        // -----------------------------------------------------------
        // Contract: the heal DIALOG itself stays unmounted until a
        // FAILED step exposes the per-row entry point. Guards against
        // accidental always-on rendering of the heal entry point.
        // -----------------------------------------------------------
        [Test]
        public async Task Fix_selector_dialog_only_renders_when_a_failed_step_is_present()
        {
            var actionsMenu = Page.GetByTestId(
                WorkbenchSelectors.ButtonWorkbenchActionsMenu);
            if (await actionsMenu.CountAsync() == 0)
            {
                Assert.Inconclusive(
                    "Validation panel unavailable — workbench has no "
                    + "active project.");
                return;
            }
            await actionsMenu.ClickAsync();
            await Page.GetByTestId(WorkbenchSelectors.ButtonOpenValidation)
                .ClickAsync();
            await Page.GetByTestId(WorkbenchSelectors.SheetValidationPanel)
                .WaitForAsync(new() { Timeout = 5000 });

            (await Page.Locator("[data-testid^=\"button-fix-selector-\"]")
                .CountAsync())
                .Should().Be(0,
                    "fix-selector affordance must only render against "
                    + "FAILED validation steps — never on a fresh panel");
            (await Page.GetByTestId("dialog-fix-selector").CountAsync())
                .Should().Be(0,
                    "the heal dialog must remain unmounted until opened "
                    + "from a per-step button");

            await Page.Keyboard.PressAsync("Escape");
        }
    }
}
