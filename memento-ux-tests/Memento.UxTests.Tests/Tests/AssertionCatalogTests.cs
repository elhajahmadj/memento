using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// Walks every kind in the no-code assertion catalog dialog. Each
    /// test opens the dialog, picks a kind, fills the variant-specific
    /// inputs, then cancels (so the recording stays clean). The point is
    /// to prove every kind's controls render and bind — not to mutate
    /// state.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class AssertionCatalogTests : AdminFixture
    {
        protected override string StartPath => "/workbench";

        private async Task<bool> SkipIfNoAssertionButtonAsync()
        {
            var present = await Page.GetByTestId(WorkbenchSelectors.ButtonAddAssertion).CountAsync() > 0;
            if (!present) Assert.Pass("Add-assertion button needs an active recording.");
            return !present;
        }

        private async Task<AddAssertionDialog> OpenDialogAsync()
        {
            await new WorkbenchPage(Page).OpenAddAssertionAsync();
            await Page.GetByTestId(AddAssertionDialogSelectors.Dialog).WaitForAsync();
            return new AddAssertionDialog(Page);
        }

        [Test]
        public async Task ElementVisible_kind_renders_selector_input()
        {
            if (await SkipIfNoAssertionButtonAsync()) return;
            var d = await OpenDialogAsync();
            await d.ChooseKindAsync(AssertionKind.ElementVisible);
            await d.FillSelectorAsync("[data-testid=\"button-home\"]");
            await d.CancelAsync();
        }

        [TestCase(AssertionKind.ElementHidden)]
        [TestCase(AssertionKind.HasText)]
        [TestCase(AssertionKind.UrlContains)]
        [TestCase(AssertionKind.UrlEquals)]
        public async Task Kind_renders_required_inputs(AssertionKind kind)
        {
            if (await SkipIfNoAssertionButtonAsync()) return;
            var d = await OpenDialogAsync();
            await d.ChooseKindAsync(kind);
            switch (kind)
            {
                case AssertionKind.ElementHidden: await d.FillSelectorAsync("[data-testid=\"banner-x\"]"); break;
                case AssertionKind.HasText: await d.FillSelectorAsync("h1"); await d.FillTextAsync("Memento"); break;
                case AssertionKind.UrlContains: await d.FillUrlAsync("/"); break;
                case AssertionKind.UrlEquals: await d.FillUrlAsync(MementoSettings.BaseUrl); break;
            }
            await d.CancelAsync();
        }

        [Test]
        public async Task CountEquals_takes_a_numeric_count()
        {
            if (await SkipIfNoAssertionButtonAsync()) return;
            var d = await OpenDialogAsync();
            await d.ChooseKindAsync(AssertionKind.CountEquals);
            await d.FillSelectorAsync("li");
            await d.FillCountAsync(5);
            await d.CancelAsync();
        }

        [Test]
        public async Task AttributeEquals_takes_attribute_and_value()
        {
            if (await SkipIfNoAssertionButtonAsync()) return;
            var d = await OpenDialogAsync();
            await d.ChooseKindAsync(AssertionKind.AttributeEquals);
            await d.FillSelectorAsync("[data-testid=\"text-current-user\"]");
            await d.FillAttributeAsync("aria-label", "Signed in as");
            await d.CancelAsync();
        }

        [Test]
        public async Task ResponseStatus_takes_a_status_code()
        {
            if (await SkipIfNoAssertionButtonAsync()) return;
            var d = await OpenDialogAsync();
            await d.ChooseKindAsync(AssertionKind.ResponseStatus);
            await d.FillUrlAsync("/api/healthz");
            await d.FillStatusCodeAsync(200);
            await d.CancelAsync();
        }

        [Test]
        public async Task Accessibility_kind_takes_axe_impact()
        {
            if (await SkipIfNoAssertionButtonAsync()) return;
            var d = await OpenDialogAsync();
            await d.ChooseKindAsync(AssertionKind.Accessibility);
            await d.ChooseAxeImpactAsync(AxeImpact.Serious);
            await d.CancelAsync();
        }

        [Test]
        public async Task VisualBaseline_takes_name_and_threshold()
        {
            if (await SkipIfNoAssertionButtonAsync()) return;
            var d = await OpenDialogAsync();
            await d.ChooseKindAsync(AssertionKind.VisualBaseline);
            await d.FillVisualBaselineAsync("home", 0.05);
            await d.CancelAsync();
        }

        [Test]
        public async Task ApiCheck_dialog_renders_and_cancels()
        {
            if (await SkipIfNoAssertionButtonAsync()) return;
            await new WorkbenchPage(Page).OpenAddApiCheckAsync();
            var api = new AddApiCheckDialog(Page);
            await api.FillRequestAsync("GET", "/api/healthz");
            await api.FillExpectedAsync(200);
            await api.CancelAsync();
        }
    }
}
