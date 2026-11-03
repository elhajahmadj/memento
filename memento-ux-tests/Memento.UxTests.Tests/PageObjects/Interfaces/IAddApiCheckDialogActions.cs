using System.Threading.Tasks;

namespace Memento.UxTests.Tests.PageObjects.Interfaces
{
    public interface IAddApiCheckDialogActions
    {
        Task FillRequestAsync(string method, string url, string? body = null);
        Task FillExpectedAsync(int statusCode, string? expectedJson = null);
        Task SubmitAsync();
        Task CancelAsync();
    }
}
