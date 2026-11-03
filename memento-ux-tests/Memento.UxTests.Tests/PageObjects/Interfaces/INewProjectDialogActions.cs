using System.Threading.Tasks;

namespace Memento.UxTests.Tests.PageObjects.Interfaces
{
    public enum SupportedLanguage { Csharp, Python, Nodejs, Java }

    public interface INewProjectDialogActions
    {
        Task FillBasicAsync(string solutionName, string testProject, string ns);
        Task ChooseLanguageAsync(SupportedLanguage language);
        Task ChooseArchitectureAsync(string architectureNameOrId);
        Task SubmitAsync();
    }
}
