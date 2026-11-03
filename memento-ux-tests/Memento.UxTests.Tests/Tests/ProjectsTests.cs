using System.Threading.Tasks;
using FluentAssertions;
using Memento.UxTests.Infrastructure.Data;
using Memento.UxTests.Infrastructure.Fixtures;
using Memento.UxTests.Shared.Configuration;
using Memento.UxTests.Tests.PageObjects.Actions;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using NUnit.Framework;

namespace Memento.UxTests.Tests.Tests
{
    [TestFixture]
    [Category(Constants.CategoryFunctional)]
    public sealed class ProjectsTests : AdminFixture
    {
        [Test]
        public async Task Admin_sees_new_project_cta_or_empty_state()
        {
            var home = new HomePage(Page);
            var has = await home.IsProjectListVisibleAsync()
                  || await home.IsTryDemoCardVisibleAsync();
            has.Should().BeTrue();
        }

        [Test]
        public async Task Opening_new_project_dialog_shows_required_fields()
        {
            var home = new HomePage(Page);
            await home.ClickNewProjectAsync();

            // The dialog has known testid inputs — assert they render.
            var dialog = new NewProjectDialog(Page);
            await dialog.FillBasicAsync(
                solutionName: TestDataFactory.ProjectName(),
                testProject:  TestDataFactory.ProjectName("Tests"),
                ns:           "Memento.Generated");
            await dialog.ChooseLanguageAsync(SupportedLanguage.Csharp);
            // Don't submit — keep the test idempotent and stop short of
            // creating real artifacts. Submission is exercised separately.
        }

        [Test]
        public async Task Try_the_demo_card_is_clickable_when_present()
        {
            var home = new HomePage(Page);
            if (await home.IsTryDemoCardVisibleAsync())
            {
                await home.ClickTryDemoAsync();
                await Page.WaitForLoadStateAsync(Microsoft.Playwright.LoadState.NetworkIdle);
            }
            else
            {
                Assert.Pass("No demo card on this seed — covered by other tests.");
            }
        }
    }
}
