using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects
{
    /// <summary>
    /// Common base for every Actions class. Holds the live <see cref="IPage"/>
    /// and exposes a small <see cref="Locator"/> helper that always
    /// resolves <c>data-testid</c> first, falling back to a CSS selector.
    /// Mirrors memento's recorder selector strategy:
    /// <c>data-testid → id → xpath → js path → aria-label → CSS</c>.
    /// </summary>
    public abstract class PageObjectBase
    {
        protected readonly IPage Page;

        protected PageObjectBase(IPage page)
        {
            Page = page;
        }

        /// <summary>
        /// Resolve a locator by raw selector. Used by Selectors classes
        /// that mix data-testid + ad-hoc CSS in the same surface.
        /// </summary>
        protected ILocator L(string selector) => Page.Locator(selector);

        /// <summary>data-testid lookup. The selector strategy memento prefers.</summary>
        protected ILocator T(string testId) => Page.GetByTestId(testId);
    }
}
