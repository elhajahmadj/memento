using System.Threading.Tasks;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects
{
    /// <summary>
    /// Helper for driving Radix-UI <c>Select</c> components from
    /// Playwright. Native <c>SelectOptionAsync</c> does not work for
    /// Radix Selects because they are composed of trigger + portal
    /// listbox rather than a real <c>&lt;select&gt;</c> element.
    ///
    /// Pattern: click the trigger by <c>data-testid</c>, then click the
    /// <c>[role=option]</c> whose text or <c>data-value</c> matches.
    /// </summary>
    public static class RadixSelectHelper
    {
        public static async Task SelectByValueAsync(IPage page, string triggerTestId, string optionValue)
        {
            await page.GetByTestId(triggerTestId).ClickAsync();
            await page.Locator($"[role=option]")
                .Filter(new() { Has = page.Locator($"[data-value=\"{optionValue}\"]") })
                .First.ClickAsync(new() { Timeout = 5000 });
        }

        public static async Task SelectByLabelAsync(IPage page, string triggerTestId, string optionLabel)
        {
            await page.GetByTestId(triggerTestId).ClickAsync();
            await page.GetByRole(AriaRole.Option, new() { Name = optionLabel })
                .First.ClickAsync(new() { Timeout = 5000 });
        }
    }
}
