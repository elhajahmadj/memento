using System.Globalization;
using System.Threading.Tasks;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    public sealed class AddAssertionDialog : PageObjectBase, IAddAssertionDialogActions
    {
        public AddAssertionDialog(IPage page) : base(page) { }

        public async Task ChooseKindAsync(AssertionKind kind)
        {
            var radioId = kind switch
            {
                AssertionKind.ElementVisible    => AddAssertionDialogSelectors.RadioElementVisible,
                AssertionKind.ElementHidden     => AddAssertionDialogSelectors.RadioElementHidden,
                AssertionKind.CountEquals       => AddAssertionDialogSelectors.RadioElementCountEquals,
                AssertionKind.AttributeEquals   => AddAssertionDialogSelectors.RadioAttributeEquals,
                AssertionKind.ValueEquals       => AddAssertionDialogSelectors.RadioValueEquals,
                AssertionKind.HasText           => AddAssertionDialogSelectors.RadioElementHasText,
                AssertionKind.UrlContains       => AddAssertionDialogSelectors.RadioUrlContains,
                AssertionKind.UrlEquals         => AddAssertionDialogSelectors.RadioUrlEquals,
                AssertionKind.ResponseStatus    => AddAssertionDialogSelectors.RadioResponseStatus,
                AssertionKind.Accessibility     => AddAssertionDialogSelectors.RadioAccessibility,
                AssertionKind.VisualBaseline    => AddAssertionDialogSelectors.RadioVisualBaseline,
                _ => AddAssertionDialogSelectors.RadioElementVisible,
            };
            await T(radioId).ClickAsync();
        }

        public async Task FillSelectorAsync(string selector) =>
            await T(AddAssertionDialogSelectors.InputSelector).FillAsync(selector);

        public async Task FillTextAsync(string text) =>
            await T(AddAssertionDialogSelectors.InputText).FillAsync(text);

        public async Task FillUrlAsync(string url) =>
            await T(AddAssertionDialogSelectors.InputUrl).FillAsync(url);

        public async Task FillCountAsync(int count) =>
            await T(AddAssertionDialogSelectors.InputCount).FillAsync(count.ToString(CultureInfo.InvariantCulture));

        public async Task FillAttributeAsync(string attribute, string value)
        {
            await T(AddAssertionDialogSelectors.InputAttribute).FillAsync(attribute);
            await T(AddAssertionDialogSelectors.InputAttrValue).FillAsync(value);
        }

        public async Task FillValueAsync(string value) =>
            await T(AddAssertionDialogSelectors.InputValue).FillAsync(value);

        public async Task FillStatusCodeAsync(int statusCode) =>
            await T(AddAssertionDialogSelectors.InputStatusCode)
                .FillAsync(statusCode.ToString(CultureInfo.InvariantCulture));

        public async Task ChooseAxeImpactAsync(AxeImpact impact)
        {
            await T(AddAssertionDialogSelectors.SelectAxeImpact).SelectOptionAsync(
                impact.ToString().ToLowerInvariant());
        }

        public async Task FillVisualBaselineAsync(string name, double threshold)
        {
            await T(AddAssertionDialogSelectors.InputVisualName).FillAsync(name);
            await T(AddAssertionDialogSelectors.InputVisualThreshold)
                .FillAsync(threshold.ToString(CultureInfo.InvariantCulture));
        }

        public async Task SubmitAsync() =>
            await T(AddAssertionDialogSelectors.ButtonAdd).ClickAsync();

        public async Task CancelAsync() =>
            await T(AddAssertionDialogSelectors.ButtonCancel).ClickAsync();
    }
}
