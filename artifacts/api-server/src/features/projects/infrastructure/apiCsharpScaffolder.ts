import fs from "node:fs/promises";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { safeJoin } from "@/features/projects/infrastructure/paths";

const CSHARP_PROJECT_TYPE_GUID = "{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}";

export const API_DEFAULT_ARCHITECTURE_ID = "api-default";
export const API_HELPER_SUFFIX = ".Automation.API";
export const API_TESTS_SUFFIX = ".Automation.API.Tests";

export interface ApiScaffoldResult {
  rootPath: string;
  slnPath: string;
  helperProjectName: string;
  testProjectName: string;
}

function genGuid(): string {
  // Deterministic-looking but unique per scaffold; used only inside the .sln.
  const hex = (n: number) =>
    Array.from({ length: n }, () =>
      Math.floor(Math.random() * 16)
        .toString(16)
        .toUpperCase(),
    ).join("");
  return `{${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}}`;
}

function helperCsproj(): string {
  return `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="8.0.10" />
    <PackageReference Include="Microsoft.Extensions.Configuration.Binder" Version="8.0.2" />
    <PackageReference Include="Microsoft.Extensions.Configuration.Json" Version="8.0.1" />
    <PackageReference Include="Microsoft.Extensions.Configuration.EnvironmentVariables" Version="8.0.0" />
    <PackageReference Include="Microsoft.Extensions.Http" Version="8.0.0" />
    <PackageReference Include="Polly" Version="8.4.1" />
  </ItemGroup>

</Project>
`;
}

function testsCsproj(helperProjectName: string): string {
  return `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <LangVersion>latest</LangVersion>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageReference Include="xunit" Version="2.9.2" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" />
    <PackageReference Include="FluentAssertions" Version="7.2.0" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\\${helperProjectName}\\${helperProjectName}.csproj" />
  </ItemGroup>

  <ItemGroup>
    <None Update="appsettings.json">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </None>
  </ItemGroup>

</Project>
`;
}

function slnContent(
  _solutionName: string,
  helperProjectName: string,
  testProjectName: string,
  helperGuid: string,
  testGuid: string,
): string {
  const projectEntries = [
    `Project("${CSHARP_PROJECT_TYPE_GUID}") = "${helperProjectName}", "${helperProjectName}\\${helperProjectName}.csproj", "${helperGuid}"\nEndProject`,
    `Project("${CSHARP_PROJECT_TYPE_GUID}") = "${testProjectName}", "${testProjectName}\\${testProjectName}.csproj", "${testGuid}"\nEndProject`,
  ].join("\n");

  const cfgLines = [helperGuid, testGuid]
    .flatMap((g) => [
      `\t\t${g}.Debug|Any CPU.ActiveCfg = Debug|Any CPU`,
      `\t\t${g}.Debug|Any CPU.Build.0 = Debug|Any CPU`,
      `\t\t${g}.Release|Any CPU.ActiveCfg = Release|Any CPU`,
      `\t\t${g}.Release|Any CPU.Build.0 = Release|Any CPU`,
    ])
    .join("\n");

  return `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
VisualStudioVersion = 17.0.31903.59
MinimumVisualStudioVersion = 10.0.40219.1
${projectEntries}
Global
\tGlobalSection(SolutionConfigurationPlatforms) = preSolution
\t\tDebug|Any CPU = Debug|Any CPU
\t\tRelease|Any CPU = Release|Any CPU
\tEndGlobalSection
\tGlobalSection(ProjectConfigurationPlatforms) = postSolution
${cfgLines}
\tEndGlobalSection
\tGlobalSection(SolutionProperties) = preSolution
\t\tHideSolutionNode = FALSE
\tEndGlobalSection
EndGlobal
`;
}

export function apiEndpointsCs(ns: string): string {
  return `namespace ${ns}.Automation.API.Constants;

/// <summary>
/// Endpoint route constants for API tests. Build Test → AssistantBuilder
/// appends new entries (or nested classes) here atomically.
/// </summary>
public static class ApiEndpoints
{
}
`;
}

function apiTestOptions(ns: string): string {
  return `namespace ${ns}.Automation.API.Infrastructure;

/// <summary>
/// Strongly-typed bindings for the per-environment URL block in
/// \`appsettings.json\` under \`ApiTest:Urls:{urlName}\`. Each generated
/// helper names a "URL Name" and the fixture maps it to one of these.
/// </summary>
public sealed class ApiTestOptions
{
    public string BaseUrl { get; init; } = string.Empty;
}
`;
}

function apiTestFixture(ns: string): string {
  return `using System.Collections.Concurrent;
using System.Net.Http;
using ${ns}.Automation.API.Extensions;
using ${ns}.Automation.API.Handlers;
using Microsoft.Extensions.Configuration;

namespace ${ns}.Automation.API.Infrastructure;

/// <summary>
/// Shared API test fixture. xUnit constructs this once per
/// <see cref="Xunit.ICollectionFixture{T}"/>, so the constructor must be
/// parameterless. URL blocks live under \`ApiTest:Urls:{urlName}\` in
/// \`appsettings.json\`; <see cref="GetClient"/> resolves the right
/// HttpClient lazily per name, with retry + logging handlers attached.
/// </summary>
public class ApiTestFixture : IDisposable
{
    private readonly ConcurrentDictionary<string, HttpClient> _clients = new();

    public IConfiguration Configuration { get; }

    public ApiTestFixture()
    {
        Configuration = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false, reloadOnChange: false)
            .AddEnvironmentVariables()
            .Build();
    }

    public ApiTestOptions GetOptions(string urlName)
    {
        var baseUrl = Configuration[$"ApiTest:Urls:{urlName}:BaseUrl"]
                      ?? throw new InvalidOperationException(
                          $"appsettings.json is missing ApiTest:Urls:{urlName}:BaseUrl");
        return new ApiTestOptions { BaseUrl = baseUrl };
    }

    public HttpClient GetClient(string urlName)
    {
        return _clients.GetOrAdd(urlName, name =>
        {
            var options = GetOptions(name);
            var inner = new HttpClientHandler();
            var logging = new HttpLoggingHandler { InnerHandler = inner };
            var retry = new RetryHandler { InnerHandler = logging };
            return new HttpClient(retry)
            {
                BaseAddress = new Uri(options.BaseUrl),
            };
        });
    }

    public void Dispose()
    {
        foreach (var client in _clients.Values)
        {
            client.Dispose();
        }
        _clients.Clear();
        GC.SuppressFinalize(this);
    }
}
`;
}

function customWebApplicationFactory(ns: string): string {
  return `using Microsoft.AspNetCore.Mvc.Testing;

namespace ${ns}.Automation.API.Infrastructure;

/// <summary>
/// Optional <see cref="WebApplicationFactory{TEntryPoint}"/> base for
/// in-process integration tests. Default API tests use the public
/// <see cref="ApiTestFixture"/> against a live <c>BaseUrl</c>; this factory
/// is here for tests that prefer to spin the SUT up in-memory.
/// </summary>
public class CustomWebApplicationFactory<TProgram> : WebApplicationFactory<TProgram>
    where TProgram : class
{
}
`;
}

function retryHandler(ns: string): string {
  return `using System.Net;

namespace ${ns}.Automation.API.Handlers;

/// <summary>
/// Retries transient HTTP failures (5xx + 408 + 429) with exponential
/// backoff. Configured via <see cref="MaxRetries"/> and
/// <see cref="BaseDelayMs"/>; both have safe defaults.
/// </summary>
public sealed class RetryHandler : DelegatingHandler
{
    public int MaxRetries { get; init; } = 3;
    public int BaseDelayMs { get; init; } = 200;

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        for (var attempt = 0; ; attempt++)
        {
            var response = await base.SendAsync(request, cancellationToken).ConfigureAwait(false);
            if (attempt >= MaxRetries || !ShouldRetry(response.StatusCode))
            {
                return response;
            }

            response.Dispose();
            var delay = TimeSpan.FromMilliseconds(BaseDelayMs * Math.Pow(2, attempt));
            await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
        }
    }

    private static bool ShouldRetry(HttpStatusCode code) =>
        (int)code >= 500 ||
        code == HttpStatusCode.RequestTimeout ||
        code == (HttpStatusCode)429;
}
`;
}

function httpLoggingHandler(ns: string): string {
  return `using System.Diagnostics;

namespace ${ns}.Automation.API.Handlers;

/// <summary>
/// Mirrors every request/response line to <see cref="Trace"/> so xUnit's
/// per-test capture and Visual Studio's Output → Tests window both pick
/// it up. Keeps payloads compact (status + method + uri + elapsed).
/// </summary>
public sealed class HttpLoggingHandler : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var sw = Stopwatch.StartNew();
        Trace.WriteLine($"[HTTP] -> {request.Method} {request.RequestUri}");
        try
        {
            var response = await base.SendAsync(request, cancellationToken).ConfigureAwait(false);
            sw.Stop();
            Trace.WriteLine($"[HTTP] <- {(int)response.StatusCode} {request.Method} {request.RequestUri} ({sw.ElapsedMilliseconds}ms)");
            return response;
        }
        catch (Exception ex)
        {
            sw.Stop();
            Trace.WriteLine($"[HTTP] !! {request.Method} {request.RequestUri} threw {ex.GetType().Name} after {sw.ElapsedMilliseconds}ms");
            throw;
        }
    }
}
`;
}

function configurationExtensions(ns: string): string {
  return `using Microsoft.Extensions.Configuration;

namespace ${ns}.Automation.API.Extensions;

/// <summary>
/// Configuration helpers for API tests. <see cref="GetAccessToken"/> is a
/// mock by default — production deployments are expected to replace its
/// body with a real token-mint call (e.g. against an IDP) before running
/// authenticated tests.
/// </summary>
public static class ConfigurationExtensions
{
    /// <summary>
    /// Mock token mint. Returns a deterministic placeholder so test runs
    /// don't accidentally hit a real IDP from CI. Replace the body with
    /// your real token acquisition (client credentials, password grant,
    /// SAML→OAuth exchange, …) when wiring up against a live API.
    /// </summary>
    public static string GetAccessToken(this IConfiguration config, string urlName)
    {
        return config[$"ApiTest:Urls:{urlName}:AccessToken"] ?? "mock-access-token";
    }
}
`;
}

function testCollectionsConstants(ns: string): string {
  return `namespace ${ns}.Automation.API.Constants;

/// <summary>
/// Canonical xUnit collection names. Generated test classes reference
/// <see cref="Api"/> directly via [Collection(TestCollections.Api)].
/// </summary>
public static class TestCollections
{
    public const string Api = "API";
}
`;
}

function apiTestCollection(ns: string): string {
  return `using ${ns}.Automation.API.Constants;
using ${ns}.Automation.API.Infrastructure;
using Xunit;

namespace ${ns}.Automation.API.Tests.Infrastructure;

/// <summary>
/// xUnit collection used by every generated API test class. Matches
/// <see cref="TestCollections.Api"/> so the framework knows which
/// fixture instance to share across tests in the collection.
/// </summary>
[CollectionDefinition(TestCollections.Api)]
public class ApiTestCollection : ICollectionFixture<ApiTestFixture>
{
}
`;
}

function appsettingsJson(): string {
  return `${JSON.stringify(
    {
      ApiTest: {
        Urls: {},
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * Scaffold a brand-new C# xUnit + HttpClient API test solution. Layout:
 *
 *   {Sln}/                                  ← rootPath
 *     {Sln}.sln
 *     .testbuilder.json                     ← solutionType: "api"
 *     {Sln}.Automation.API/
 *       {Sln}.Automation.API.csproj
 *       Constants/ApiEndpoints.cs
 *       Infrastructure/ApiTestFixture.cs
 *       Infrastructure/CustomWebApplicationFactory.cs
 *       Infrastructure/ApiTestOptions.cs
 *       Handlers/RetryHandler.cs
 *       Handlers/HttpLoggingHandler.cs
 *       Extensions/ConfigurationExtensions.cs
 *     {Sln}.Automation.API.Tests/
 *       {Sln}.Automation.API.Tests.csproj
 *       appsettings.json
 *       Infrastructure/ApiTestCollection.cs
 *       APITestingAssistants/               ← one assistant class per suite
 *                                             (created by Build Test)
 *       Tests/                              ← test classes land here
 */
export async function scaffoldApiCsharp(
  solutionName: string,
  namespace: string,
): Promise<ApiScaffoldResult> {
  await fs.mkdir(recorderConfig.workspaceDir, { recursive: true });
  const rootPath = path.join(recorderConfig.workspaceDir, solutionName);
  await fs.mkdir(rootPath, { recursive: true });

  const helperProjectName = `${solutionName}${API_HELPER_SUFFIX}`;
  const testProjectName = `${solutionName}${API_TESTS_SUFFIX}`;

  const helperDir = safeJoin(rootPath, helperProjectName);
  const testsDir = safeJoin(rootPath, testProjectName);
  await fs.mkdir(helperDir, { recursive: true });
  await fs.mkdir(testsDir, { recursive: true });

  // --- helper library ---
  await fs.mkdir(safeJoin(helperDir, "Constants"), { recursive: true });
  await fs.mkdir(safeJoin(helperDir, "Infrastructure"), { recursive: true });
  await fs.mkdir(safeJoin(helperDir, "Handlers"), { recursive: true });
  await fs.mkdir(safeJoin(helperDir, "Extensions"), { recursive: true });

  await fs.writeFile(
    safeJoin(helperDir, `${helperProjectName}.csproj`),
    helperCsproj(),
  );
  await fs.writeFile(
    safeJoin(helperDir, "Constants/ApiEndpoints.cs"),
    apiEndpointsCs(namespace),
  );
  await fs.writeFile(
    safeJoin(helperDir, "Constants/TestCollections.cs"),
    testCollectionsConstants(namespace),
  );
  await fs.writeFile(
    safeJoin(helperDir, "Infrastructure/ApiTestFixture.cs"),
    apiTestFixture(namespace),
  );
  await fs.writeFile(
    safeJoin(helperDir, "Infrastructure/CustomWebApplicationFactory.cs"),
    customWebApplicationFactory(namespace),
  );
  await fs.writeFile(
    safeJoin(helperDir, "Infrastructure/ApiTestOptions.cs"),
    apiTestOptions(namespace),
  );
  await fs.writeFile(
    safeJoin(helperDir, "Handlers/RetryHandler.cs"),
    retryHandler(namespace),
  );
  await fs.writeFile(
    safeJoin(helperDir, "Handlers/HttpLoggingHandler.cs"),
    httpLoggingHandler(namespace),
  );
  await fs.writeFile(
    safeJoin(helperDir, "Extensions/ConfigurationExtensions.cs"),
    configurationExtensions(namespace),
  );

  // --- test project ---
  await fs.mkdir(safeJoin(testsDir, "Infrastructure"), { recursive: true });
  await fs.mkdir(safeJoin(testsDir, "Tests"), { recursive: true });
  await fs.mkdir(safeJoin(testsDir, "APITestingAssistants"), {
    recursive: true,
  });
  await fs.mkdir(safeJoin(testsDir, "Constants"), { recursive: true });
  await fs.mkdir(safeJoin(testsDir, "TestCategories"), { recursive: true });
  await fs.writeFile(
    safeJoin(testsDir, "Tests/.gitkeep"),
    "",
  );
  await fs.writeFile(
    safeJoin(testsDir, "APITestingAssistants/.gitkeep"),
    "",
  );
  await fs.writeFile(safeJoin(testsDir, "Constants/.gitkeep"), "");
  await fs.writeFile(safeJoin(testsDir, "TestCategories/.gitkeep"), "");
  await fs.writeFile(
    safeJoin(testsDir, `${testProjectName}.csproj`),
    testsCsproj(helperProjectName),
  );
  await fs.writeFile(
    safeJoin(testsDir, "appsettings.json"),
    appsettingsJson(),
  );
  await fs.writeFile(
    safeJoin(testsDir, "Infrastructure/ApiTestCollection.cs"),
    apiTestCollection(namespace),
  );

  // --- solution ---
  const slnPath = path.join(rootPath, `${solutionName}.sln`);
  await fs.writeFile(
    slnPath,
    slnContent(
      solutionName,
      helperProjectName,
      testProjectName,
      genGuid(),
      genGuid(),
    ),
  );

  return { rootPath, slnPath, helperProjectName, testProjectName };
}
