using NUnit.Framework;
using Memento.UxTests.Shared.Configuration;

namespace Memento.UxTests.Tests.Tests
{
    /// <summary>
    /// REQUIREMENTS.md does not document a locale toggle for the
    /// memento UI today: the login form, top-nav, settings page, and
    /// every dialog ship English copy hard-coded into JSX. There is no
    /// <c>i18n</c> provider, no language switcher in the top-nav user
    /// menu, no <c>lang</c> attribute swap in the document, and no
    /// translated string catalog under <c>artifacts/test-builder/src</c>.
    ///
    /// This file is intentionally a TODO placeholder per task-66 step
    /// "Multi-language sign-in / locale — If any locale toggling
    /// exists, assert it; otherwise drop a TODO note rather than
    /// silently leaving uncovered surface area." The test is marked
    /// <c>[Ignore]</c> so it shows up in the run report (and in code
    /// search) without producing a green or red signal until the
    /// product ships a locale switcher.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class MultiLanguageTodoTests
    {
        [Test]
        [Ignore("TODO: memento ships English-only today; add locale assertions when an i18n surface exists.")]
        public void Locale_toggle_swaps_visible_strings()
        {
            // Intentionally blank. Re-enable when the top-nav (or
            // settings → Appearance) exposes a language picker.
        }
    }
}
