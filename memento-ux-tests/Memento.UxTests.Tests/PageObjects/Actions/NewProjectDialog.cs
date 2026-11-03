using System.Threading.Tasks;
using Memento.UxTests.Tests.PageObjects.Interfaces;
using Memento.UxTests.Tests.PageObjects.Selectors;
using Microsoft.Playwright;

namespace Memento.UxTests.Tests.PageObjects.Actions
{
    public sealed class NewProjectDialog : PageObjectBase, INewProjectDialogActions
    {
        public NewProjectDialog(IPage page) : base(page) { }

        public async Task FillBasicAsync(string solutionName, string testProject, string ns)
        {
            await T(NewProjectDialogSelectors.InputSolutionName).FillAsync(solutionName);
            await T(NewProjectDialogSelectors.InputTestProject).FillAsync(testProject);
            await T(NewProjectDialogSelectors.InputNamespace).FillAsync(ns);
        }

        public async Task ChooseLanguageAsync(SupportedLanguage language)
        {
            await T(NewProjectDialogSelectors.SelectLanguage).ClickAsync();
            var optionId = language switch
            {
                SupportedLanguage.Csharp  => NewProjectDialogSelectors.OptionLanguageCsharp,
                SupportedLanguage.Python  => NewProjectDialogSelectors.OptionLanguagePython,
                SupportedLanguage.Nodejs  => NewProjectDialogSelectors.OptionLanguageNodejs,
                SupportedLanguage.Java    => NewProjectDialogSelectors.OptionLanguageJava,
                _ => NewProjectDialogSelectors.OptionLanguageCsharp,
            };
            await T(optionId).ClickAsync();
        }

        public async Task ChooseArchitectureAsync(string architectureNameOrId)
        {
            await T(NewProjectDialogSelectors.SelectArchitecture).ClickAsync();
            await Page.GetByRole(AriaRole.Option, new() { Name = architectureNameOrId }).ClickAsync();
        }

        public async Task SubmitAsync() =>
            await T(NewProjectDialogSelectors.ButtonCreateProject).ClickAsync();
    }
}
