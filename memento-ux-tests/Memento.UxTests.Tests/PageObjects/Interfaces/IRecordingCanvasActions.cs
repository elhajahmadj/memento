using System.Threading.Tasks;

namespace Memento.UxTests.Tests.PageObjects.Interfaces
{
    public interface IRecordingCanvasActions
    {
        Task FillTypedValueAsync(string value);
        Task ConfirmFillAsync();
        Task CancelFillAsync();
        Task<string> ReadSuggestedMethodNameAsync();
        Task AcceptNameAsync();
        Task EditNameAsync(string name);
        Task SkipNameAsync();
    }
}
