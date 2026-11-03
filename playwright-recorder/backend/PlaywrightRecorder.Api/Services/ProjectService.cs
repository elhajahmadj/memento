using System.Text;
using PlaywrightRecorder.Api.Models;

namespace PlaywrightRecorder.Api.Services;

public interface IProjectService
{
    ProjectInfo? Current { get; }
    ProjectInfo Scaffold(NewProjectRequest request);
    ProjectInfo Load(LoadProjectRequest request);
}

public sealed class ProjectService : IProjectService
{
    private readonly IConfiguration _configuration;
    private readonly ISolutionParser _parser;
    private readonly ICodeGenerationService _codegen;
    private ProjectInfo? _current;

    public ProjectService(IConfiguration configuration, ISolutionParser parser, ICodeGenerationService codegen)
    {
        _configuration = configuration;
        _parser = parser;
        _codegen = codegen;
    }

    public ProjectInfo? Current => _current;

    public ProjectInfo Scaffold(NewProjectRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.SolutionName)) throw new ArgumentException("Solution name is required.");
        if (string.IsNullOrWhiteSpace(request.RootDirectory)) throw new ArgumentException("Root directory is required.");
        if (string.IsNullOrWhiteSpace(request.TestProjectName)) throw new ArgumentException("Test project name is required.");
        if (string.IsNullOrWhiteSpace(request.DefaultNamespace)) throw new ArgumentException("Default namespace is required.");

        var solutionDir = Path.Combine(request.RootDirectory, request.SolutionName);
        var testProjectDir = Path.Combine(solutionDir, request.TestProjectName);

        Directory.CreateDirectory(solutionDir);
        Directory.CreateDirectory(testProjectDir);
        Directory.CreateDirectory(Path.Combine(testProjectDir, "Base"));
        Directory.CreateDirectory(Path.Combine(testProjectDir, "Services"));
        Directory.CreateDirectory(Path.Combine(testProjectDir, "Tests"));
        Directory.CreateDirectory(Path.Combine(testProjectDir, "PageObjects"));
        Directory.CreateDirectory(Path.Combine(testProjectDir, "PageObjects", "Selectors"));

        var slnPath = Path.Combine(solutionDir, $"{request.SolutionName}.sln");
        File.WriteAllText(slnPath, BuildSlnFile(request.SolutionName, request.TestProjectName));

        var csprojPath = Path.Combine(testProjectDir, $"{request.TestProjectName}.csproj");
        File.WriteAllText(csprojPath, BuildCsproj());

        File.WriteAllText(Path.Combine(testProjectDir, "appsettings.json"),
            "{\n  \"DefaultBrowser\": \"Edge\",\n  \"Headless\": false\n}\n");

        InjectTemplate("TestFixturePath",     Path.Combine(testProjectDir, "Base",     "TestFixture.cs"),    request.DefaultNamespace);
        InjectTemplate("IBrowserServicePath", Path.Combine(testProjectDir, "Services", "IBrowserService.cs"), request.DefaultNamespace);
        InjectTemplate("BrowserServicePath",  Path.Combine(testProjectDir, "Services", "BrowserService.cs"),  request.DefaultNamespace);

        var info = new ProjectInfo(
            request.SolutionName,
            slnPath,
            solutionDir,
            request.TestProjectName,
            testProjectDir,
            request.DefaultNamespace);

        _current = info;
        return info;
    }

    public ProjectInfo Load(LoadProjectRequest request)
    {
        if (!File.Exists(request.SolutionPath))
            throw new FileNotFoundException("Solution file not found.", request.SolutionPath);

        var info = _parser.Parse(request.SolutionPath);
        _current = info;
        return info;
    }

    private void InjectTemplate(string configKey, string destinationPath, string ns)
    {
        var relative = _configuration[$"TemplateFiles:{configKey}"];
        if (string.IsNullOrWhiteSpace(relative)) return;

        var sourcePath = Path.IsPathRooted(relative)
            ? relative
            : Path.Combine(AppContext.BaseDirectory, relative);

        if (!File.Exists(sourcePath)) return;

        var content = File.ReadAllText(sourcePath).Replace("{Namespace}", ns);
        File.WriteAllText(destinationPath, content);
    }

    private static string BuildSlnFile(string solutionName, string testProjectName)
    {
        var projectGuid = Guid.NewGuid().ToString("B").ToUpperInvariant();
        var sb = new StringBuilder();
        sb.AppendLine("Microsoft Visual Studio Solution File, Format Version 12.00");
        sb.AppendLine("# Visual Studio Version 17");
        sb.AppendLine("VisualStudioVersion = 17.0.0.0");
        sb.AppendLine("MinimumVisualStudioVersion = 10.0.40219.1");
        sb.AppendLine($"Project(\"{{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}}\") = \"{testProjectName}\", \"{testProjectName}\\{testProjectName}.csproj\", \"{projectGuid}\"");
        sb.AppendLine("EndProject");
        sb.AppendLine("Global");
        sb.AppendLine("\tGlobalSection(SolutionConfigurationPlatforms) = preSolution");
        sb.AppendLine("\t\tDebug|Any CPU = Debug|Any CPU");
        sb.AppendLine("\t\tRelease|Any CPU = Release|Any CPU");
        sb.AppendLine("\tEndGlobalSection");
        sb.AppendLine("\tGlobalSection(ProjectConfigurationPlatforms) = postSolution");
        sb.AppendLine($"\t\t{projectGuid}.Debug|Any CPU.ActiveCfg = Debug|Any CPU");
        sb.AppendLine($"\t\t{projectGuid}.Debug|Any CPU.Build.0 = Debug|Any CPU");
        sb.AppendLine($"\t\t{projectGuid}.Release|Any CPU.ActiveCfg = Release|Any CPU");
        sb.AppendLine($"\t\t{projectGuid}.Release|Any CPU.Build.0 = Release|Any CPU");
        sb.AppendLine("\tEndGlobalSection");
        sb.AppendLine("EndGlobal");
        return sb.ToString();
    }

    private static string BuildCsproj() => """
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.Playwright" Version="1.47.0" />
    <PackageReference Include="NUnit" Version="4.2.2" />
    <PackageReference Include="NUnit3TestAdapter" Version="4.6.0" />
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageReference Include="Microsoft.Extensions.Configuration" Version="9.0.0" />
    <PackageReference Include="Microsoft.Extensions.Configuration.Json" Version="9.0.0" />
    <PackageReference Include="Microsoft.Extensions.DependencyInjection" Version="9.0.0" />
  </ItemGroup>

  <ItemGroup>
    <None Update="appsettings.json">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </None>
  </ItemGroup>

</Project>
""";
}
