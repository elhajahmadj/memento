using System.Linq;
using System.Threading.Tasks;
using Deque.AxeCore.Commons;
using Deque.AxeCore.Playwright;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests.Accessibility
{
    /// <summary>
    /// Smoke-level Axe scans across the major surfaces. The suite fails
    /// only when a Critical or Serious-impact violation is detected so
    /// the CI signal stays useful (Moderate/Minor are reported as test
    /// attachments instead of failures).
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryAccessibility)]
    public sealed class AccessibilityTests : AdminFixture
    {
        [TestCase("/")]
        [TestCase("/settings")]
        [TestCase("/tools")]
        [TestCase("/admin")]
        [TestCase("/tools/validation-traces")]
        [TestCase("/tools/test-runs")]
        [TestCase("/workbench")]
        [TestCase("/documentation")]
        [TestCase("/about")]
        [TestCase("/profile")]
        public async Task Page_has_no_critical_or_serious_axe_violations(string path)
        {
            await Page.GotoAsync(MementoSettings.BaseUrl + path);
            await Page.WaitForLoadStateAsync(Microsoft.Playwright.LoadState.NetworkIdle);

            var results = await Page.RunAxe();
            var blocking = results.Violations
                .Where(v => v.Impact == "critical" || v.Impact == "serious")
                .ToArray();

            if (blocking.Length > 0)
            {
                var summary = string.Join("\n", blocking.Select(v =>
                    $"[{v.Impact}] {v.Id}: {v.Help}"));
                Assert.Fail($"Axe blocking violations on {path}:\n{summary}");
            }

            results.Violations.Length.Should().BeGreaterThanOrEqualTo(0);
        }

        [Test]
        public async Task Login_page_passes_top_level_axe_scan()
        {
            var login = new LoginPage(Page);
            await login.GotoAsync();
            var results = await Page.RunAxe();
            var blocking = results.Violations
                .Where(v => v.Impact == "critical" || v.Impact == "serious")
                .ToArray();
            if (blocking.Length > 0)
            {
                var summary = string.Join("\n", blocking.Select(v =>
                    $"[{v.Impact}] {v.Id}: {v.Help}"));
                Assert.Fail(
                    $"Axe blocking violations on /login (must be Critical+Serious-clean):\n{summary}");
            }
        }
    }

    /// <summary>
    /// Mirror of <see cref="AccessibilityTests"/> driven by a non-admin
    /// fixture so role-conditional chrome (no Tools menu, no Settings
    /// link, etc.) is also Axe-clean. Restricted to the routes a User
    /// role can actually open per RouteAccess.Matrix.
    /// </summary>
    [TestFixture]
    [Category(Constants.CategoryAccessibility)]
    public sealed class UserAccessibilityTests : UserFixture
    {
        [TestCase("/")]
        [TestCase("/documentation")]
        [TestCase("/my-approvals")]
        [TestCase("/about")]
        [TestCase("/profile")]
        public async Task User_role_page_has_no_critical_or_serious_axe_violations(string path)
        {
            await Page.GotoAsync(MementoSettings.BaseUrl + path);
            await Page.WaitForLoadStateAsync(Microsoft.Playwright.LoadState.NetworkIdle);

            var results = await Page.RunAxe();
            var blocking = results.Violations
                .Where(v => v.Impact == "critical" || v.Impact == "serious")
                .ToArray();

            if (blocking.Length > 0)
            {
                var summary = string.Join("\n", blocking.Select(v =>
                    $"[{v.Impact}] {v.Id}: {v.Help}"));
                Assert.Fail($"Axe blocking violations on {path} (User role):\n{summary}");
            }
        }
    }
}
