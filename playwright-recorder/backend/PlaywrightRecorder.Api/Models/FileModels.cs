namespace PlaywrightRecorder.Api.Models;

public sealed record CreateFileRequest(string Path, string? Content);
public sealed record UpdateFileRequest(string Path, string Content);
public sealed record RenameRequest(string OldPath, string NewPath);
public sealed record CreateFolderRequest(string Path);
public sealed record DeletePathRequest(string Path);

public sealed record FileContentResponse(string Path, string Content);
