using System.Threading.Tasks;

namespace Memento.UxTests.Tests.PageObjects.Interfaces
{
    public enum RecordingTarget { TestMethod, BeforeEach, OneTimeSetUp }

    public interface IStartRecordingDialogActions
    {
        Task SetStartUrlAsync(string url);
        Task SetUrlNameAsync(string name);
        Task SetMethodNameAsync(string methodName);
        Task SetNewClassAsync(string className);
        Task PickTargetAsync(RecordingTarget target);
        Task ConfirmStartAsync();
        Task<bool> IsHookOverwriteWarningVisibleAsync();
        Task ConfirmHookOverwriteAsync();
        Task CancelHookOverwriteAsync();
    }
}
