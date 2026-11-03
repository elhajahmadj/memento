using System.Text.RegularExpressions;
using System.Xml.Linq;
using PlaywrightRecorder.Api.Models;

namespace PlaywrightRecorder.Api.Services;

public interface ISolutionParser
{
    ProjectInfo Parse(string slnPath);
}

public sealed class SolutionParser : ISolutionParser
{
    private static readonly Regex ProjectRegex =
        new(@"^Project\(""\{[^}]+\}""\)\s*=\s*""(?<name>[^""]+)""\s*,\s*""(?<path>[^""]+\.csproj)""",
            RegexOptions.Multiline | RegexOptions.Compiled);

    public ProjectInfo Parse(string slnPath)
    {
        var slnText = File.ReadAllText(slnPath);
        var solutionDir = Path.GetDirectoryName(slnPath)!;
        var solutionName = Path.GetFileNameWithoutExtension(slnPath);

        var match = ProjectRegex.Match(slnText);
        string projectName = solutionName;
        string projectDir = solutionDir;
        string defaultNamespace = solutionName;

        if (match.Success)
        {
            projectName = match.Groups["name"].Value;
            var csprojRel = match.Groups["path"].Value.Replace('\\', Path.DirectorySeparatorChar);
            var csprojPath = Path.GetFullPath(Path.Combine(solutionDir, csprojRel));
            projectDir = Path.GetDirectoryName(csprojPath) ?? solutionDir;

            if (File.Exists(csprojPath))
            {
                try
                {
                    var doc = XDocument.Load(csprojPath);
                    var rootNs = doc.Descendants("RootNamespace").FirstOrDefault()?.Value;
                    if (!string.IsNullOrWhiteSpace(rootNs)) defaultNamespace = rootNs;
                    else defaultNamespace = projectName;
                }
                catch
                {
                    defaultNamespace = projectName;
                }
            }
        }

        return new ProjectInfo(
            solutionName,
            slnPath,
            solutionDir,
            projectName,
            projectDir,
            defaultNamespace);
    }
}
