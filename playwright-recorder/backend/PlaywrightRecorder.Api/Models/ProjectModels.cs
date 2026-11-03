namespace PlaywrightRecorder.Api.Models;

public sealed record NewProjectRequest(
    string SolutionName,
    string RootDirectory,
    string TestProjectName,
    string DefaultNamespace);

public sealed record LoadProjectRequest(string SolutionPath);

public sealed record ProjectInfo(
    string SolutionName,
    string SolutionPath,
    string SolutionDirectory,
    string TestProjectName,
    string TestProjectDirectory,
    string DefaultNamespace);

public sealed class TreeNode
{
    public string Name { get; set; } = "";
    public string Path { get; set; } = "";
    public string Type { get; set; } = "folder"; // folder | file
    public string? Extension { get; set; }
    public List<TreeNode> Children { get; set; } = new();
}
