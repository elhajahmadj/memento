using System.Threading.Tasks;

namespace Memento.UxTests.Tests.PageObjects.Interfaces
{
    public enum AssertionKind
    {
        ElementVisible,
        ElementHidden,
        CountEquals,
        AttributeEquals,
        ValueEquals,
        HasText,
        UrlContains,
        UrlEquals,
        ResponseStatus,
        Accessibility,
        VisualBaseline,
    }

    public enum AxeImpact { Minor, Moderate, Serious, Critical }

    public interface IAddAssertionDialogActions
    {
        Task ChooseKindAsync(AssertionKind kind);
        Task FillSelectorAsync(string selector);
        Task FillTextAsync(string text);
        Task FillUrlAsync(string url);
        Task FillCountAsync(int count);
        Task FillAttributeAsync(string attribute, string value);
        Task FillValueAsync(string value);
        Task FillStatusCodeAsync(int statusCode);
        Task ChooseAxeImpactAsync(AxeImpact impact);
        Task FillVisualBaselineAsync(string name, double threshold);
        Task SubmitAsync();
        Task CancelAsync();
    }
}
