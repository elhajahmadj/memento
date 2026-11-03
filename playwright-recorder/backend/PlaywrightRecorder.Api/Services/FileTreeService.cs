using PlaywrightRecorder.Api.Models;

namespace PlaywrightRecorder.Api.Services;

public interface IFileTreeService
{
    TreeNode BuildTree(string rootPath);
    void EnsureInsideProject(string path, string projectRoot);
}

public sealed class FileTreeService : IFileTreeService
{
    private static readonly HashSet<string> IgnoredDirs =
        new(StringComparer.OrdinalIgnoreCase) { "bin", "obj", ".vs", ".git", "node_modules" };

    public TreeNode BuildTree(string rootPath)
    {
        if (!Directory.Exists(rootPath))
            throw new DirectoryNotFoundException(rootPath);

        return BuildNode(new DirectoryInfo(rootPath));
    }

    private static TreeNode BuildNode(DirectoryInfo dir)
    {
        var node = new TreeNode
        {
            Name = dir.Name,
            Path = dir.FullName,
            Type = "folder"
        };

        foreach (var sub in dir.EnumerateDirectories().OrderBy(d => d.Name))
        {
            if (IgnoredDirs.Contains(sub.Name)) continue;
            node.Children.Add(BuildNode(sub));
        }

        foreach (var file in dir.EnumerateFiles().OrderBy(f => f.Name))
        {
            node.Children.Add(new TreeNode
            {
                Name = file.Name,
                Path = file.FullName,
                Type = "file",
                Extension = file.Extension.TrimStart('.').ToLowerInvariant()
            });
        }

        return node;
    }

    public void EnsureInsideProject(string path, string projectRoot)
    {
        var full = Path.GetFullPath(path);
        var root = Path.GetFullPath(projectRoot);
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException($"Path '{path}' is outside the loaded project.");
    }
}
