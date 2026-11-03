namespace PlaywrightRecorder.Api.Models;

public sealed record GenerateTestClassRequest(
    string ClassName,
    string Namespace,
    string FolderPath); // absolute path to the folder where the file goes

public sealed record GenerateTestMethodRequest(
    string FilePath,
    string MethodName);

public sealed record GeneratePageObjectRequest(
    string PageName,
    string Namespace,
    string PageObjectsFolder,
    Dictionary<string, string> Selectors,           // logical name -> selector string
    List<PageObjectAction> Actions);

public sealed record PageObjectAction(
    string MethodName,                              // e.g. EnterUsername
    string SelectorKey,                             // e.g. UsernameInput
    string ActionType,                              // fill | click | check | select
    string? ParameterName,                          // e.g. username
    string? ParameterType);                         // e.g. string

public sealed record GeneratedFileResult(string Path, bool Created);
