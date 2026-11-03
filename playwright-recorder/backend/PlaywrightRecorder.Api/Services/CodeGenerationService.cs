using System.Text;
using PlaywrightRecorder.Api.Models;

namespace PlaywrightRecorder.Api.Services;

public interface ICodeGenerationService
{
    GeneratedFileResult GenerateTestClass(GenerateTestClassRequest request);
    GeneratedFileResult AddTestMethod(GenerateTestMethodRequest request);
    IEnumerable<GeneratedFileResult> GeneratePageObject(GeneratePageObjectRequest request);
}

public sealed class CodeGenerationService : ICodeGenerationService
{
    public GeneratedFileResult GenerateTestClass(GenerateTestClassRequest request)
    {
        Directory.CreateDirectory(request.FolderPath);
        var filePath = Path.Combine(request.FolderPath, $"{request.ClassName}.cs");
        if (File.Exists(filePath)) return new GeneratedFileResult(filePath, false);

        var content = $@"using NUnit.Framework;
using {request.Namespace}.Base;

namespace {request.Namespace}.Tests
{{
    [TestFixture]
    public class {request.ClassName} : TestFixture
    {{
        [SetUp]
        public new void Setup()
        {{
            // class-level setup
        }}

        [TearDown]
        public new void Teardown()
        {{
            // class-level teardown
        }}
    }}
}}
";
        File.WriteAllText(filePath, content);
        return new GeneratedFileResult(filePath, true);
    }

    public GeneratedFileResult AddTestMethod(GenerateTestMethodRequest request)
    {
        if (!File.Exists(request.FilePath))
            throw new FileNotFoundException("Test class file not found.", request.FilePath);

        var lines = File.ReadAllLines(request.FilePath).ToList();
        var lastClosing = -1;
        var braceDepth = 0;
        for (var i = 0; i < lines.Count; i++)
        {
            foreach (var ch in lines[i])
            {
                if (ch == '{') braceDepth++;
                else if (ch == '}') braceDepth--;
            }
            if (braceDepth == 1 && lines[i].Trim() == "}") { lastClosing = i; break; }
        }

        var insertion = $@"
        [Test]
        public async Task {request.MethodName}()
        {{
            // generated steps will be inserted here
            await Task.CompletedTask;
        }}
";

        if (lastClosing < 0) lastClosing = lines.Count - 1;
        lines.Insert(lastClosing, insertion);
        File.WriteAllLines(request.FilePath, lines);
        return new GeneratedFileResult(request.FilePath, true);
    }

    public IEnumerable<GeneratedFileResult> GeneratePageObject(GeneratePageObjectRequest request)
    {
        Directory.CreateDirectory(request.PageObjectsFolder);
        var selectorsFolder = Path.Combine(request.PageObjectsFolder, "Selectors");
        Directory.CreateDirectory(selectorsFolder);

        var selectorsFile = Path.Combine(selectorsFolder, $"{request.PageName}Selectors.cs");
        var pageObjectFile = Path.Combine(request.PageObjectsFolder, $"{request.PageName}.cs");

        var selectorsContent = BuildSelectorsClass(request);
        var pageObjectContent = BuildPageObjectClass(request);

        var selectorsCreated = !File.Exists(selectorsFile);
        var pageObjectCreated = !File.Exists(pageObjectFile);

        File.WriteAllText(selectorsFile, selectorsContent);
        File.WriteAllText(pageObjectFile, pageObjectContent);

        return new[]
        {
            new GeneratedFileResult(selectorsFile, selectorsCreated),
            new GeneratedFileResult(pageObjectFile, pageObjectCreated)
        };
    }

    private static string BuildSelectorsClass(GeneratePageObjectRequest r)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"namespace {r.Namespace}.PageObjects.Selectors");
        sb.AppendLine("{");
        sb.AppendLine($"    public static class {r.PageName}Selectors");
        sb.AppendLine("    {");
        foreach (var kvp in r.Selectors)
        {
            var escaped = kvp.Value.Replace("\"", "\\\"");
            sb.AppendLine($"        public static readonly string {kvp.Key} = \"{escaped}\";");
        }
        sb.AppendLine("    }");
        sb.AppendLine("}");
        return sb.ToString();
    }

    private static string BuildPageObjectClass(GeneratePageObjectRequest r)
    {
        var sb = new StringBuilder();
        sb.AppendLine("using Microsoft.Playwright;");
        sb.AppendLine($"using {r.Namespace}.PageObjects.Selectors;");
        sb.AppendLine();
        sb.AppendLine($"namespace {r.Namespace}.PageObjects");
        sb.AppendLine("{");
        sb.AppendLine($"    public class {r.PageName}");
        sb.AppendLine("    {");
        sb.AppendLine("        private readonly IPage _page;");
        sb.AppendLine();
        sb.AppendLine($"        public {r.PageName}(IPage page)");
        sb.AppendLine("        {");
        sb.AppendLine("            _page = page;");
        sb.AppendLine("        }");

        foreach (var a in r.Actions)
        {
            sb.AppendLine();
            switch (a.ActionType)
            {
                case "fill":
                    sb.AppendLine($"        public async Task {a.MethodName}({a.ParameterType ?? "string"} {a.ParameterName ?? "value"})");
                    sb.AppendLine($"            => await _page.FillAsync({r.PageName}Selectors.{a.SelectorKey}, {a.ParameterName ?? "value"});");
                    break;
                case "click":
                    sb.AppendLine($"        public async Task {a.MethodName}()");
                    sb.AppendLine($"            => await _page.ClickAsync({r.PageName}Selectors.{a.SelectorKey});");
                    break;
                case "check":
                    sb.AppendLine($"        public async Task {a.MethodName}()");
                    sb.AppendLine($"            => await _page.CheckAsync({r.PageName}Selectors.{a.SelectorKey});");
                    break;
                case "select":
                    sb.AppendLine($"        public async Task {a.MethodName}(string value)");
                    sb.AppendLine($"            => await _page.SelectOptionAsync({r.PageName}Selectors.{a.SelectorKey}, value);");
                    break;
                default:
                    sb.AppendLine($"        public async Task {a.MethodName}()");
                    sb.AppendLine($"            => await _page.ClickAsync({r.PageName}Selectors.{a.SelectorKey});");
                    break;
            }
        }

        sb.AppendLine("    }");
        sb.AppendLine("}");
        return sb.ToString();
    }
}
