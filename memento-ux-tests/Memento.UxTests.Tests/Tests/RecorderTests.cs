using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// Workbench coverage. The recorder needs an active project
    /// (architecture loaded, files on disk) to attach to. When that
    /// precondition is absent the tests use Assert.Inconclusive (not
    /// Assert.Pass) so the gap is reported as such instead of a silent
    /// green. When the precondition is met every behavioural step is
    /// hard-asserted.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class WorkbenchTests : AdminFixture
    {
        protected override string StartPath => "/workbench";

        [Test]
        public async Task Workbench_toolbar_renders()
        {
            (await Page.GetByTestId(WorkbenchSelectors.ButtonStartRecording)
                .CountAsync()).Should().BeGreaterThan(0);
        }

        [Test]
        public async Task Validation_panel_opens_and_renders_validate_all_button()
        {
            var wb = new WorkbenchPage(Page);
            if (await Page.GetByTestId(WorkbenchSelectors.ButtonWorkbenchActionsMenu).CountAsync() == 0)
            {
                Assert.Inconclusive("Workbench has no active project to validate.");
                return;
            }
            await wb.OpenValidationPanelAsync();
            (await wb.IsValidationPanelOpenAsync()).Should().BeTrue();
        }
    }

    internal static class RecorderGate
    {
        public static async Task<RecorderFlowHelper> StartOrInconclusiveAsync(
            IPage page, string methodName,
            RecordingTarget target = RecordingTarget.TestMethod)
        {
            var helper = new RecorderFlowHelper(page);
            if (!await helper.EnsureCanStartAsync())
            {
                Assert.Inconclusive(
                    "Workbench has no active project — recorder unavailable. "
                    + "Provision the seed UX-tests project to exercise this case.");
            }
            var started = await helper.StartRecordingAsync(target,
                target == RecordingTarget.TestMethod ? methodName : null,
                "RecorderUxTests");
            if (!started)
            {
                Assert.Inconclusive(
                    "Recorder browser failed to start (no architecture / "
                    + "Chromium missing). Ensure Playwright Chromium is "
                    + "installed and an architecture is loaded.");
            }
            return helper;
        }

        public static async Task<ILocator> WaitForCanvasAsync(IPage page)
        {
            var canvas = page.GetByTestId(WorkbenchSelectors.RecordingCanvas);
            await canvas.First.WaitForAsync(new() { Timeout = 15000 });
            (await canvas.IsVisibleAsync()).Should().BeTrue(
                "recording canvas must render before we can drive it");
            return canvas;
        }

        /// <summary>Click the canvas at relative (xPct,yPct).</summary>
        public static async Task ClickCanvasAsync(
            IPage page, ILocator canvas, double xPct, double yPct)
        {
            var box = await canvas.BoundingBoxAsync();
            box.Should().NotBeNull("canvas must have a bounding box");
            await page.Mouse.ClickAsync(
                (float)(box!.X + box.Width * xPct),
                (float)(box.Y + box.Height * yPct));
        }

        /// <summary>
        /// Resolve a fill prompt (when one appears) by typing into
        /// either the input or textarea variant of the dialog.
        /// </summary>
        public static async Task ResolveFillPromptIfPresentAsync(IPage page, string typed)
        {
            var prompt = page.GetByTestId(RecordingCanvasSelectors.DialogFillPrompt);
            try { await prompt.WaitForAsync(new() { Timeout = 3000 }); } catch { }
            if (!await prompt.IsVisibleAsync()) return;
            var ta = page.GetByTestId(RecordingCanvasSelectors.InputFillValueTextarea);
            if (await ta.CountAsync() > 0 && await ta.IsVisibleAsync())
            {
                await ta.FillAsync(typed);
            }
            else
            {
                await page.GetByTestId(RecordingCanvasSelectors.InputFillValue).FillAsync(typed);
            }
            await page.GetByTestId(RecordingCanvasSelectors.ButtonFillSubmit).ClickAsync();
            await page.WaitForFunctionAsync(
                "() => !document.querySelector('[data-testid=\"dialog-fill-prompt\"]')",
                new PageWaitForFunctionOptions { Timeout = 5000 });
        }

        /// <summary>Auto-accept any name dialog with Enter.</summary>
        public static async Task AcceptNameDialogIfPresentAsync(IPage page)
        {
            var name = page.GetByTestId(RecordingCanvasSelectors.DialogNameAction);
            try { await name.WaitForAsync(new() { Timeout = 5000 }); } catch { }
            if (!await name.IsVisibleAsync()) return;
            await page.Keyboard.PressAsync("Enter");
            await page.WaitForFunctionAsync(
                "() => !document.querySelector('[data-testid=\"dialog-name-action\"]')",
                new PageWaitForFunctionOptions { Timeout = 5000 });
        }

        /// <summary>
        /// Click the canvas, resolve any fill prompt, accept the name
        /// dialog, then hard-wait for the action feed row count to
        /// strictly increase. Waiting on row 0's existence alone would
        /// pass even when the click landed on an unrecorded surface.
        /// </summary>
        public static async Task RecordOneAsync(
            IPage page, ILocator canvas, double xPct, double yPct, string typed = "x")
        {
            var beforeCount = await page.Locator("[data-testid^=\"action-feed-item-\"]")
                .CountAsync();
            await ClickCanvasAsync(page, canvas, xPct, yPct);
            await ResolveFillPromptIfPresentAsync(page, typed);
            await AcceptNameDialogIfPresentAsync(page);
            await page.WaitForFunctionAsync(
                $"() => document.querySelectorAll('[data-testid^=\"action-feed-item-\"]').length > {beforeCount}",
                new PageWaitForFunctionOptions { Timeout = 8000 });
        }
    }

    /// <summary>
    /// Capture-flow coverage. Drives the deterministic
    /// <c>/api/ux-fixture</c> page so each click lands on a specific
    /// element kind and the captured row's badge is hard-asserted to
    /// match the expected action kind.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class RecorderCaptureFlowTests : AdminFixture
    {
        protected override string StartPath => "/workbench";

        private static async Task<string> AllRowTextAsync(ActionsFeed feed)
        {
            var n = await feed.CountVisibleAsync();
            var combined = string.Empty;
            for (var i = 0; i < n; i++)
            {
                combined += "\n" + (await feed.Item(i).InnerTextAsync());
            }
            return combined.ToLowerInvariant();
        }

        private async Task AssertRow0NameMatchesAsync(string regex, string targetKind)
        {
            var name = await Page.GetByTestId(ActionsFeedSelectors.ActionMethodName(0))
                .InnerTextAsync();
            name.Should().MatchRegex(regex,
                $"row 0's suggested method name must reflect the {targetKind} target "
                + $"(got '{name}')");
        }

        [Test]
        public async Task Click_on_button_records_a_click_row_with_button_named_method()
        {
            var helper = await RecorderGate.StartOrInconclusiveAsync(Page, "ClickFlow");
            try
            {
                var canvas = await RecorderGate.WaitForCanvasAsync(Page);
                await RecorderGate.RecordOneAsync(Page, canvas, 0.5, RecorderFlowHelper.YButton);
                var feed = new ActionsFeed(Page);
                (await feed.CountVisibleAsync()).Should().BeGreaterThan(0);
                (await AllRowTextAsync(feed)).Should().Contain("click",
                    "button click must record a click action");
                await AssertRow0NameMatchesAsync(@"(?i)click|button", "button");
            }
            finally { await helper.StopAsync(); await helper.DiscardAsync(); }
        }

        [Test]
        public async Task Fill_into_input_records_a_fill_row_with_input_named_method()
        {
            var helper = await RecorderGate.StartOrInconclusiveAsync(Page, "FillFlow");
            try
            {
                var canvas = await RecorderGate.WaitForCanvasAsync(Page);
                await RecorderGate.RecordOneAsync(Page, canvas, 0.5,
                    RecorderFlowHelper.YInput, typed: "ux-fill-value");
                var feed = new ActionsFeed(Page);
                (await AllRowTextAsync(feed)).Should().MatchRegex(@"fill|type",
                    "filling an input must record a fill/type action");
                await AssertRow0NameMatchesAsync(@"(?i)fill|type|input|ux", "input");
            }
            finally { await helper.StopAsync(); await helper.DiscardAsync(); }
        }

        [Test]
        public async Task Select_on_native_select_records_a_select_row_with_select_named_method()
        {
            var helper = await RecorderGate.StartOrInconclusiveAsync(Page, "SelectFlow");
            try
            {
                var canvas = await RecorderGate.WaitForCanvasAsync(Page);
                await RecorderGate.RecordOneAsync(Page, canvas, 0.5,
                    RecorderFlowHelper.YSelect, typed: "beta");
                var feed = new ActionsFeed(Page);
                (await AllRowTextAsync(feed)).Should().MatchRegex(@"select|option",
                    "interacting with a <select> must record a select action");
                await AssertRow0NameMatchesAsync(@"(?i)select|option|ux", "select");
            }
            finally { await helper.StopAsync(); await helper.DiscardAsync(); }
        }

        [Test]
        public async Task Check_on_checkbox_records_a_check_row_with_check_named_method()
        {
            var helper = await RecorderGate.StartOrInconclusiveAsync(Page, "CheckFlow");
            try
            {
                var canvas = await RecorderGate.WaitForCanvasAsync(Page);
                await RecorderGate.RecordOneAsync(Page, canvas, 0.5,
                    RecorderFlowHelper.YCheckbox);
                var feed = new ActionsFeed(Page);
                (await AllRowTextAsync(feed)).Should().MatchRegex(@"check|click",
                    "clicking a checkbox must record a check (or click) action");
                await AssertRow0NameMatchesAsync(@"(?i)check|click|ux", "checkbox");
            }
            finally { await helper.StopAsync(); await helper.DiscardAsync(); }
        }
    }

    /// <summary>
    /// "Name this action" popup variants — accept (Enter), edit, skip
    /// (Escape) per REQUIREMENTS.md:136-139.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class RecorderNameActionPopupTests : AdminFixture
    {
        protected override string StartPath => "/workbench";

        private async Task<(RecorderFlowHelper helper, string suggested)>
            StartAndOpenNameDialogAsync(string method)
        {
            var helper = await RecorderGate.StartOrInconclusiveAsync(Page, method);
            var canvas = await RecorderGate.WaitForCanvasAsync(Page);
            // Click the button band — never opens a fill prompt, always
            // surfaces the name dialog.
            await RecorderGate.ClickCanvasAsync(Page, canvas, 0.5, RecorderFlowHelper.YButton);
            var dialog = Page.GetByTestId(RecordingCanvasSelectors.DialogNameAction);
            await dialog.WaitForAsync(new() { Timeout = 8000 });
            (await dialog.IsVisibleAsync()).Should().BeTrue();
            var suggested = await new RecordingCanvas(Page).ReadSuggestedMethodNameAsync();
            return (helper, suggested);
        }

        [Test]
        public async Task Accept_default_name_with_enter_keeps_suggested_name()
        {
            var (helper, suggested) = await StartAndOpenNameDialogAsync("AcceptName");
            try
            {
                await Page.Keyboard.PressAsync("Enter");
                await Page.WaitForFunctionAsync(
                    "() => !document.querySelector('[data-testid=\"dialog-name-action\"]')",
                    new PageWaitForFunctionOptions { Timeout = 5000 });
                var name = await Page.GetByTestId(ActionsFeedSelectors.ActionMethodName(0))
                    .InnerTextAsync();
                name.Should().Contain(suggested,
                    "Enter must commit the suggested name onto the row");
            }
            finally { await helper.StopAsync(); await helper.DiscardAsync(); }
        }

        [Test]
        public async Task Edit_then_accept_uses_custom_name()
        {
            var (helper, _) = await StartAndOpenNameDialogAsync("EditName");
            try
            {
                await new RecordingCanvas(Page).EditNameAsync("ClickPrimaryButton");
                await Page.WaitForFunctionAsync(
                    "() => !document.querySelector('[data-testid=\"dialog-name-action\"]')",
                    new PageWaitForFunctionOptions { Timeout = 5000 });
                var name = await Page.GetByTestId(ActionsFeedSelectors.ActionMethodName(0))
                    .InnerTextAsync();
                name.Should().Contain("ClickPrimaryButton",
                    "edited name must replace the suggested one");
            }
            finally { await helper.StopAsync(); await helper.DiscardAsync(); }
        }

        [Test]
        public async Task Skip_with_escape_dismisses_dialog()
        {
            var (helper, _) = await StartAndOpenNameDialogAsync("SkipName");
            try
            {
                await Page.Keyboard.PressAsync("Escape");
                await Page.WaitForFunctionAsync(
                    "() => !document.querySelector('[data-testid=\"dialog-name-action\"]')",
                    new PageWaitForFunctionOptions { Timeout = 5000 });
                (await Page.GetByTestId(RecordingCanvasSelectors.DialogNameAction)
                    .IsVisibleAsync()).Should().BeFalse(
                    "Escape must close the name dialog");
            }
            finally { await helper.StopAsync(); await helper.DiscardAsync(); }
        }
    }

    /// <summary>
    /// Inline fill prompt for editable fields. Each test case targets
    /// a deterministic element kind on /api/ux-fixture (input,
    /// textarea, contenteditable) so the prompt's behaviour is
    /// verified against the actual target type — not just inferred.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class RecorderFillPromptTests : AdminFixture
    {
        protected override string StartPath => "/workbench";

        [TestCase("input",            RecorderFlowHelper.YInput,           "input-fill-value")]
        [TestCase("textarea",         RecorderFlowHelper.YTextarea,        "input-fill-value-textarea")]
        [TestCase("contenteditable",  RecorderFlowHelper.YContentEditable, "input-fill-value")]
        public async Task Fill_prompt_handles_target_kind(
            string kind, double yPct, string inputTestId)
        {
            var helper = await RecorderGate.StartOrInconclusiveAsync(Page, $"FillPrompt_{kind}");
            try
            {
                var canvas = await RecorderGate.WaitForCanvasAsync(Page);
                await RecorderGate.ClickCanvasAsync(Page, canvas, 0.5, yPct);
                var prompt = Page.GetByTestId(RecordingCanvasSelectors.DialogFillPrompt);
                await prompt.WaitForAsync(new() { Timeout = 8000 });
                (await prompt.IsVisibleAsync()).Should().BeTrue(
                    $"fill prompt must surface for {kind} target");
                var input = Page.GetByTestId(inputTestId);
                (await input.CountAsync()).Should().BeGreaterThan(0,
                    $"the {kind} fill prompt must expose '{inputTestId}'");
                await input.First.FillAsync($"value-for-{kind}");
                await Page.GetByTestId(RecordingCanvasSelectors.ButtonFillSubmit).ClickAsync();
                await Page.WaitForFunctionAsync(
                    "() => !document.querySelector('[data-testid=\"dialog-fill-prompt\"]')",
                    new PageWaitForFunctionOptions { Timeout = 5000 });
                // Captured row must reflect the filled value.
                var feed = new ActionsFeed(Page);
                (await feed.CountVisibleAsync()).Should().BeGreaterThan(0);
                var combined = (await feed.Item(0).InnerTextAsync()).ToLowerInvariant();
                combined.Should().Contain($"value-for-{kind}",
                    $"row 0 must surface the value typed for {kind}");
            }
            finally { await helper.StopAsync(); await helper.DiscardAsync(); }
        }
    }

    /// <summary>
    /// Start Recording dialog target variants. Each case actually
    /// starts a recording for the target mode and asserts the Stop
    /// Recording button surfaces — proving the recorder accepted the
    /// target — then stops + discards. The hook overwrite test
    /// additionally verifies the warning surfaces against a class
    /// whose hook has custom code.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class StartRecordingTargetTests : AdminFixture
    {
        protected override string StartPath => "/workbench";

        [TestCase(RecordingTarget.TestMethod,   "target-test")]
        [TestCase(RecordingTarget.BeforeEach,   "target-before")]
        [TestCase(RecordingTarget.OneTimeSetUp, "target-onetime")]
        public async Task Target_mode_starts_recording_and_marks_radio(
            RecordingTarget target, string radioId)
        {
            var helper = await RecorderGate.StartOrInconclusiveAsync(Page, $"Tgt_{target}", target);
            try
            {
                // Stop button visible == recording started for this target.
                (await Page.GetByTestId(WorkbenchSelectors.ButtonStopRecording).IsVisibleAsync())
                    .Should().BeTrue(
                    $"Stop Recording must appear after starting a {target} recording");

                // Radio mark check requires re-opening the dialog, which
                // we can't do mid-recording. Instead, verify by re-
                // opening the dialog after stopping below.
                await helper.StopAsync();
                await helper.DiscardAsync();

                await Page.GetByTestId(WorkbenchSelectors.ButtonStartRecording).ClickAsync();
                var dlg = new StartRecordingDialog(Page);
                await dlg.PickTargetAsync(target);
                var radio = Page.Locator($"#{radioId}");
                (await radio.GetAttributeAsync("aria-checked")).Should().Be("true",
                    $"target picker must mark {target} as the active option");
                await Page.Keyboard.PressAsync("Escape");
            }
            finally
            {
                await helper.StopAsync();
                await helper.DiscardAsync();
            }
        }

        [Test]
        public async Task Hook_overwrite_warning_and_confirmation_prompt_surface()
        {
            var btn = Page.GetByTestId(WorkbenchSelectors.ButtonStartRecording);
            if (await btn.CountAsync() == 0)
            { Assert.Inconclusive("No project loaded — Start Recording absent."); return; }
            await btn.ClickAsync();
            var dlg = new StartRecordingDialog(Page);
            await dlg.SetStartUrlAsync(MementoSettings.BaseUrl + RecorderFlowHelper.FixtureUrl);
            await dlg.SetUrlNameAsync(RecorderFlowHelper.FixtureUrlName);
            await dlg.PickTargetAsync(RecordingTarget.OneTimeSetUp);

            // Switch to "Add to existing test suite" mode.
            var modeExisting = Page.Locator("#mode-existing");
            if (await modeExisting.CountAsync() == 0
                || !await modeExisting.IsEnabledAsync())
            {
                await Page.Keyboard.PressAsync("Escape");
                Assert.Inconclusive(
                    "No existing test classes available to exercise the hook overwrite path.");
                return;
            }
            await modeExisting.ClickAsync();

            // The class picker is a Radix Select, not a native <select>.
            // Open it, enumerate role=option items, and walk them looking
            // for one whose hook has custom code (the warning surfaces).
            var trigger = Page.GetByTestId(StartRecordingDialogSelectors.SelectExistingClass);
            await trigger.WaitForAsync(new() { Timeout = 5000 });
            await trigger.ClickAsync();
            var options = Page.GetByRole(AriaRole.Option);
            await options.First.WaitForAsync(new() { Timeout = 3000 });
            var optionCount = await options.CountAsync();
            optionCount.Should().BeGreaterThan(0,
                "existing-class picker must list at least one class");

            var optionTexts = new System.Collections.Generic.List<string>();
            for (var i = 0; i < optionCount; i++)
            {
                optionTexts.Add((await options.Nth(i).InnerTextAsync()).Trim());
            }
            await Page.Keyboard.PressAsync("Escape");

            var warn = Page.GetByTestId(StartRecordingDialogSelectors.WarningHookHasCustomCode);
            var foundClassWithHookContent = false;
            foreach (var optionName in optionTexts)
            {
                if (string.IsNullOrWhiteSpace(optionName)) continue;
                await trigger.ClickAsync();
                var item = Page.GetByRole(AriaRole.Option, new() { Name = optionName });
                if (await item.CountAsync() == 0)
                {
                    await Page.Keyboard.PressAsync("Escape");
                    continue;
                }
                await item.First.ClickAsync();
                try
                {
                    await warn.First.WaitForAsync(new() { Timeout = 3000 });
                    foundClassWithHookContent = true;
                    break;
                }
                catch { /* try next class */ }
            }

            if (!foundClassWithHookContent)
            {
                await Page.Keyboard.PressAsync("Escape");
                Assert.Inconclusive(
                    "No seeded class has a populated OneTimeSetUpAsync hook body. "
                    + "Seed one to exercise the overwrite confirmation prompt.");
                return;
            }

            (await warn.IsVisibleAsync()).Should().BeTrue(
                "pre-start hook-has-custom-code warning must surface");

            // Now actually attempt to start recording — the overwrite
            // confirmation AlertDialog must appear before the recorder
            // boots.
            await Page.GetByTestId(StartRecordingDialogSelectors.ButtonConfirmStartRecording)
                .ClickAsync();
            var confirmBtn = Page.GetByTestId("button-confirm-overwrite-hook");
            var cancelBtn = Page.GetByTestId("button-cancel-overwrite-hook");
            await confirmBtn.First.WaitForAsync(new() { Timeout = 5000 });
            (await confirmBtn.IsVisibleAsync()).Should().BeTrue(
                "overwrite-and-record button must surface in the confirmation prompt");
            (await cancelBtn.IsVisibleAsync()).Should().BeTrue(
                "cancel button must surface in the confirmation prompt");

            // Cancel — leave the project untouched.
            await cancelBtn.ClickAsync();
            try
            {
                await Page.WaitForFunctionAsync(
                    "() => !document.querySelector('[data-testid=\"button-confirm-overwrite-hook\"]')",
                    new PageWaitForFunctionOptions { Timeout = 5000 });
            }
            catch { /* tolerated */ }
            await Page.Keyboard.PressAsync("Escape");
        }
    }

    /// <summary>
    /// Stop Recording leaves captured actions visible for review.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class StopRecordingReviewTests_Admin : AdminFixture
    {
        protected override string StartPath => "/workbench";

        [Test]
        public async Task Admin_actions_remain_visible_after_stop()
            => await StopRecordingReviewSharedAssertions.RunAsync(Page);
    }

    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class StopRecordingReviewTests_Limited : LimitedAdminFixture
    {
        protected override string StartPath => "/workbench";

        [Test]
        public async Task Limited_fork_owner_actions_remain_visible_after_stop()
            => await StopRecordingReviewSharedAssertions.RunAsync(Page);
    }

    internal static class StopRecordingReviewSharedAssertions
    {
        public static async Task RunAsync(IPage page)
        {
            var helper = await RecorderGate.StartOrInconclusiveAsync(page, "StopReviewFlow");
            try
            {
                var canvas = await RecorderGate.WaitForCanvasAsync(page);
                await RecorderGate.RecordOneAsync(page, canvas, 0.5, RecorderFlowHelper.YButton);
                var feed = new ActionsFeed(page);
                var rowsBefore = await feed.CountVisibleAsync();
                rowsBefore.Should().BeGreaterThan(0,
                    "must capture at least one action before stopping");

                await helper.StopAsync();

                (await page.GetByTestId(WorkbenchSelectors.TextRecordingStopped).IsVisibleAsync())
                    .Should().BeTrue("stopped badge must surface after Stop");
                (await feed.CountVisibleAsync()).Should().Be(rowsBefore,
                    "captured rows must remain visible after Stop for review");
            }
            finally { await helper.DiscardAsync(); }
        }
    }

    /// <summary>
    /// Per-row edit menu coverage. Each test exercises one op then
    /// strictly asserts the matching <c>recorded_action_edit</c> audit
    /// row (op tag matched in the details payload) via
    /// <see cref="AuditLogChecker"/>.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ActionEditMenuTests : AdminFixture
    {
        protected override string StartPath => "/workbench";

        private async Task<(ActionsFeed feed, RecorderFlowHelper helper, int seeded)>
            SeedRowsAsync(int minRows = 2)
        {
            var helper = await RecorderGate.StartOrInconclusiveAsync(Page, "EditMenuFlow");
            var canvas = await RecorderGate.WaitForCanvasAsync(Page);
            // Hit three distinct bands to reliably create 3 rows.
            var ys = new[]
            {
                RecorderFlowHelper.YButton,
                RecorderFlowHelper.YCheckbox,
                RecorderFlowHelper.YSelect,
            };
            for (var i = 0; i < ys.Length; i++)
            {
                await RecorderGate.RecordOneAsync(Page, canvas, 0.5, ys[i],
                    typed: i == 2 ? "beta" : "x");
            }
            var feed = new ActionsFeed(Page);
            var count = await feed.CountVisibleAsync();
            if (count < minRows)
            {
                Assert.Inconclusive(
                    $"Expected at least {minRows} captured rows, got {count}.");
            }
            return (feed, helper, count);
        }

        /// <summary>
        /// Snapshot the count of `recorded_action_edit` rows tagged
        /// with <paramref name="opTag"/> BEFORE the test starts a
        /// recording session, then return to /workbench. The caller
        /// asserts post-op count &gt; this value so historical rows
        /// can never produce a false positive.
        /// </summary>
        private async Task<int> SnapshotAuditCountAsync(string opTag)
        {
            var checker = new AuditLogChecker(Page);
            await checker.GotoActivityAsync();
            var before = await checker.CountRecordedActionEditRowsAsync(opTag);
            await Page.GotoAsync(MementoSettings.BaseUrl + "/workbench");
            await Page.GetByTestId(WorkbenchSelectors.ButtonStartRecording)
                .First.WaitForAsync(new() { Timeout = 8000 });
            return before;
        }

        private async Task AssertAuditGrewAsync(string opTag, int before)
        {
            var checker = new AuditLogChecker(Page);
            await checker.GotoActivityAsync();
            var after = await checker.CountRecordedActionEditRowsAsync(opTag);
            after.Should().BeGreaterThan(before,
                $"Activity log must gain a NEW recorded_action_edit row "
                + $"tagged '{opTag}' after the operation (before={before}, after={after})");
        }

        [Test]
        public async Task Edit_value_writes_strict_audit()
        {
            var auditBefore = await SnapshotAuditCountAsync("edit-action-value");
            var s = await SeedRowsAsync();
            try
            {
                var btn = Page.GetByTestId(ActionsFeedSelectors.ButtonEditValueAction(0));
                if (await btn.CountAsync() == 0)
                { Assert.Inconclusive("Row 0 is not value-editable for this action kind."); return; }
                await s.feed.EditValueAsync(0, "edited-by-test");
                await s.helper.StopAsync();
                await AssertAuditGrewAsync("edit-action-value", auditBefore);
            }
            finally { await s.helper.DiscardAsync(); }
        }

        [Test]
        public async Task Rename_writes_strict_audit()
        {
            var auditBefore = await SnapshotAuditCountAsync("rename-action");
            var s = await SeedRowsAsync();
            try
            {
                if (await Page.GetByTestId(ActionsFeedSelectors.ButtonRenameAction(0)).CountAsync() == 0)
                { Assert.Inconclusive("Rename button missing on row 0 (no method name yet)."); return; }
                await s.feed.RenameAsync(0, "RenamedAction1");
                var nameAfter = await Page.GetByTestId(
                    ActionsFeedSelectors.ActionMethodName(0)).InnerTextAsync();
                nameAfter.Should().Contain("RenamedAction1",
                    "row 0 must reflect the renamed method name");
                await s.helper.StopAsync();
                await AssertAuditGrewAsync("rename-action", auditBefore);
            }
            finally { await s.helper.DiscardAsync(); }
        }

        [Test]
        public async Task Insert_assertion_above_writes_strict_audit()
        {
            var auditBefore = await SnapshotAuditCountAsync("assertion");
            var s = await SeedRowsAsync();
            try
            {
                await s.feed.InsertAssertionAboveAsync(0);
                var dlg = new AddAssertionDialog(Page);
                await dlg.ChooseKindAsync(AssertionKind.UrlContains);
                await dlg.FillUrlAsync("/");
                await dlg.SubmitAsync();
                await s.helper.StopAsync();
                // Server emits either "add-assertion" or "insert-assertion"
                // depending on position; "assertion" matches both tags.
                await AssertAuditGrewAsync("assertion", auditBefore);
            }
            finally { await s.helper.DiscardAsync(); }
        }

        [Test]
        public async Task Insert_assertion_below_writes_strict_audit()
        {
            var auditBefore = await SnapshotAuditCountAsync("assertion");
            var s = await SeedRowsAsync();
            try
            {
                await s.feed.InsertAssertionBelowAsync(0);
                var dlg = new AddAssertionDialog(Page);
                await dlg.ChooseKindAsync(AssertionKind.UrlContains);
                await dlg.FillUrlAsync("/");
                await dlg.SubmitAsync();
                await s.helper.StopAsync();
                await AssertAuditGrewAsync("assertion", auditBefore);
            }
            finally { await s.helper.DiscardAsync(); }
        }

        [Test]
        public async Task Duplicate_writes_strict_audit_and_grows_feed()
        {
            var auditBefore = await SnapshotAuditCountAsync("duplicate-action");
            var s = await SeedRowsAsync();
            try
            {
                var before = await s.feed.CountVisibleAsync();
                await s.feed.DuplicateAsync(0);
                await Page.WaitForFunctionAsync(
                    $"() => document.querySelectorAll('[data-testid^=\"action-feed-item-\"]').length > {before}",
                    new PageWaitForFunctionOptions { Timeout = 5000 });
                (await s.feed.CountVisibleAsync()).Should().Be(before + 1);
                await s.helper.StopAsync();
                await AssertAuditGrewAsync("duplicate-action", auditBefore);
            }
            finally { await s.helper.DiscardAsync(); }
        }

        [Test]
        public async Task Move_up_writes_strict_audit()
        {
            var auditBefore = await SnapshotAuditCountAsync("move-action");
            var s = await SeedRowsAsync();
            try
            {
                var nameTopBefore = await Page.GetByTestId(
                    ActionsFeedSelectors.ActionMethodName(0)).InnerTextAsync();
                await s.feed.MoveUpAsync(1);
                var nameTopAfter = await Page.GetByTestId(
                    ActionsFeedSelectors.ActionMethodName(0)).InnerTextAsync();
                nameTopAfter.Should().NotBe(nameTopBefore,
                    "moving up must change the row at the top of the feed");
                await s.helper.StopAsync();
                await AssertAuditGrewAsync("move-action", auditBefore);
            }
            finally { await s.helper.DiscardAsync(); }
        }

        [Test]
        public async Task Move_down_writes_strict_audit()
        {
            var auditBefore = await SnapshotAuditCountAsync("move-action");
            var s = await SeedRowsAsync();
            try
            {
                var nameTopBefore = await Page.GetByTestId(
                    ActionsFeedSelectors.ActionMethodName(0)).InnerTextAsync();
                await s.feed.MoveDownAsync(0);
                var nameTopAfter = await Page.GetByTestId(
                    ActionsFeedSelectors.ActionMethodName(0)).InnerTextAsync();
                nameTopAfter.Should().NotBe(nameTopBefore,
                    "moving down row 0 must change which row is at the top");
                await s.helper.StopAsync();
                await AssertAuditGrewAsync("move-action", auditBefore);
            }
            finally { await s.helper.DiscardAsync(); }
        }

        [Test]
        public async Task Delete_writes_strict_audit_and_shrinks_feed()
        {
            var auditBefore = await SnapshotAuditCountAsync("delete-action");
            var s = await SeedRowsAsync();
            try
            {
                var before = await s.feed.CountVisibleAsync();
                await s.feed.DeleteAsync(0);
                await Page.WaitForFunctionAsync(
                    $"() => document.querySelectorAll('[data-testid^=\"action-feed-item-\"]').length < {before}",
                    new PageWaitForFunctionOptions { Timeout = 5000 });
                (await s.feed.CountVisibleAsync()).Should().Be(before - 1);
                await s.helper.StopAsync();
                await AssertAuditGrewAsync("delete-action", auditBefore);
            }
            finally { await s.helper.DiscardAsync(); }
        }

        [Test]
        public async Task Undo_delete_restores_row_count_and_writes_strict_audit()
        {
            var deleteBefore = await SnapshotAuditCountAsync("delete-action");
            var undeleteBefore = await SnapshotAuditCountAsync("undelete-action");
            var s = await SeedRowsAsync();
            try
            {
                var before = await s.feed.CountVisibleAsync();
                await s.feed.DeleteAsync(0);
                await Page.WaitForFunctionAsync(
                    $"() => document.querySelectorAll('[data-testid^=\"action-feed-item-\"]').length === {before - 1}",
                    new PageWaitForFunctionOptions { Timeout = 5000 });
                await s.feed.UndoDeleteAsync(0);
                await Page.WaitForFunctionAsync(
                    $"() => document.querySelectorAll('[data-testid^=\"action-feed-item-\"]').length === {before}",
                    new PageWaitForFunctionOptions { Timeout = 5000 });
                (await s.feed.CountVisibleAsync()).Should().Be(before,
                    "undo must restore the deleted row");
                await s.helper.StopAsync();
                var checker = new AuditLogChecker(Page);
                await checker.GotoActivityAsync();
                (await checker.CountRecordedActionEditRowsAsync("delete-action"))
                    .Should().BeGreaterThan(deleteBefore,
                    "the delete must emit a delete-action audit row");
                (await checker.CountRecordedActionEditRowsAsync("undelete-action"))
                    .Should().BeGreaterThan(undeleteBefore,
                    "the undo must emit an undelete-action audit row");
            }
            finally { await s.helper.DiscardAsync(); }
        }

        [Test]
        public async Task Bulk_delete_via_checkboxes_and_toolbar_decreases_count()
        {
            var auditBefore = await SnapshotAuditCountAsync("delete-actions");
            var s = await SeedRowsAsync(minRows: 3);
            try
            {
                var before = await s.feed.CountVisibleAsync();
                await s.feed.SelectRowAsync(0);
                await s.feed.SelectRowAsync(1);
                var deleteSelected = Page.GetByTestId(ActionsFeedSelectors.ButtonDeleteSelected);
                (await deleteSelected.IsEnabledAsync()).Should().BeTrue(
                    "Delete-selected must enable once rows are checked");
                await s.feed.DeleteSelectedAsync();
                await Page.WaitForFunctionAsync(
                    $"() => document.querySelectorAll('[data-testid^=\"action-feed-item-\"]').length <= {before - 2}",
                    new PageWaitForFunctionOptions { Timeout = 5000 });
                (await s.feed.CountVisibleAsync()).Should().BeLessOrEqualTo(before - 2,
                    "bulk delete must remove the two selected rows");
                await s.helper.StopAsync();
                await AssertAuditGrewAsync("delete-actions", auditBefore);
            }
            finally { await s.helper.DiscardAsync(); }
        }
    }

    /// <summary>
    /// Pop-out / enlarge of the recording canvas round-trips and the
    /// resized layout still responds to controls. Asserts the popout
    /// canvas is strictly larger than the inline canvas.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class RecordingPopoutTests : AdminFixture
    {
        protected override string StartPath => "/workbench";

        [Test]
        public async Task Pop_out_recording_canvas_round_trips_and_enlarges()
        {
            var helper = await RecorderGate.StartOrInconclusiveAsync(Page, "PopoutFlow");
            try
            {
                var inlineCanvas = await RecorderGate.WaitForCanvasAsync(Page);
                var inlineBox = await inlineCanvas.BoundingBoxAsync();
                inlineBox.Should().NotBeNull();

                var wb = new WorkbenchPage(Page);
                await wb.PopOutRecordingAsync();
                var overlay = Page.GetByTestId(RecordingCanvasSelectors.RecordingPopoutOverlay);
                await overlay.First.WaitForAsync(new() { Timeout = 5000 });
                (await overlay.IsVisibleAsync()).Should().BeTrue();

                var popoutCanvas = Page.GetByTestId(WorkbenchSelectors.RecordingCanvasPopout);
                await popoutCanvas.First.WaitForAsync(new() { Timeout = 5000 });
                var popoutBox = await popoutCanvas.BoundingBoxAsync();
                popoutBox.Should().NotBeNull();
                (popoutBox!.Width * popoutBox.Height).Should().BeGreaterThan(
                    inlineBox!.Width * inlineBox.Height,
                    "popout must enlarge the canvas viewport");

                await wb.ClosePopOutAsync();
                await Page.WaitForFunctionAsync(
                    "() => !document.querySelector('[data-testid=\"recording-popout-overlay\"]')",
                    new PageWaitForFunctionOptions { Timeout = 5000 });
            }
            finally { await helper.StopAsync(); await helper.DiscardAsync(); }
        }
    }
}
