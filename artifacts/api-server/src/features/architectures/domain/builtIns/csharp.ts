/**
 * C# (.NET / NUnit / Playwright) default architecture.
 *
 * Templates for the three-project layout (Shared / Infrastructure /
 * Tests) plus the builder that assembles them into an `Architecture`.
 */
import {
  type ArchProject,
  type Architecture,
  DEFAULT_ARCHITECTURE_ID,
} from "../types";

// The C# default architecture and the codegen scaffolders share the same
// shared-library `.cs` source files. They live as `.txt` resources under
// `codegen/infrastructure/templates/` (loaded via esbuild's text loader)
// so both consumers can read the exact same bytes. Importing the raw
// `.txt` files keeps this `domain` module pure from the layering rule's
// perspective — `.txt` resources are data, not code dependencies.

// @ts-expect-error -- text loader provided by esbuild build config & vitest fallback
import testFixtureRaw from "@/features/codegen/infrastructure/templates/_testfixture.txt";
// @ts-expect-error -- text loader
import testFixtureBaseRaw from "@/features/codegen/infrastructure/templates/_testfixturebase.txt";
// @ts-expect-error -- text loader
import iBrowserManagerRaw from "@/features/codegen/infrastructure/templates/_ibrowsermanager.txt";
// @ts-expect-error -- text loader
import browserManagerRaw from "@/features/codegen/infrastructure/templates/_browsermanager.txt";
// @ts-expect-error -- text loader
import testContextHelperRaw from "@/features/codegen/infrastructure/templates/_testcontexthelper.txt";
// @ts-expect-error -- text loader
import testOutputLoggerRaw from "@/features/codegen/infrastructure/templates/_testoutputlogger.txt";
// @ts-expect-error -- text loader
import testTrackerRaw from "@/features/codegen/infrastructure/templates/_testtracker.txt";
// @ts-expect-error -- text loader
import testConfigRaw from "@/features/codegen/infrastructure/templates/_testconfig.txt";
// @ts-expect-error -- text loader
import constantsRaw from "@/features/codegen/infrastructure/templates/_constants.txt";
// @ts-expect-error -- text loader
import appConfigRaw from "@/features/codegen/infrastructure/templates/_appconfigurationextensions.txt";
// @ts-expect-error -- text loader
import playwrightTraceRaw from "@/features/codegen/infrastructure/templates/_playwrighttraceextensions.txt";

const TEMPLATES = {
  testFixtureBase: testFixtureBaseRaw as string,
  testFixture: testFixtureRaw as string,
  iBrowserManager: iBrowserManagerRaw as string,
  browserManager: browserManagerRaw as string,
  testContextHelper: testContextHelperRaw as string,
  testOutputLogger: testOutputLoggerRaw as string,
  testTracker: testTrackerRaw as string,
  testConfig: testConfigRaw as string,
  constants: constantsRaw as string,
  appConfigurationExtensions: appConfigRaw as string,
  playwrightTraceExtensions: playwrightTraceRaw as string,
};

const SHARED_CSPROJ_CONTENT = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.Configuration" Version="8.0.0" />
    <PackageReference Include="Microsoft.Extensions.Configuration.Json" Version="8.0.0" />
    <PackageReference Include="Microsoft.Extensions.Configuration.Binder" Version="8.0.0" />
    <PackageReference Include="Microsoft.Extensions.Configuration.EnvironmentVariables" Version="8.0.0" />
    <PackageReference Include="NUnit" Version="4.2.2" />
    <!--
      Azure Key Vault is optional. To opt in, add a SecretClientExtensions.cs
      file under Shared/Extensions/ (a static helper that resolves
      "@KeyVault:SecretName" placeholders in IConfiguration via
      Azure.Security.KeyVault.Secrets.SecretClient) and uncomment the
      two package references below:
        <PackageReference Include="Azure.Identity" Version="1.13.1" />
        <PackageReference Include="Azure.Security.KeyVault.Secrets" Version="4.7.0" />
    -->
  </ItemGroup>

</Project>
`;

const INFRA_CSPROJ_CONTENT = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.Playwright" Version="1.55.0" />
    <PackageReference Include="Microsoft.Extensions.Configuration" Version="8.0.0" />
    <PackageReference Include="Microsoft.Extensions.DependencyInjection" Version="8.0.0" />
    <PackageReference Include="NUnit" Version="4.2.2" />
    <PackageReference Include="Bogus" Version="35.6.1" />
    <!-- Pinned to 7.x: FluentAssertions 8.0+ ships under a commercial license. -->
    <PackageReference Include="FluentAssertions" Version="7.2.0" />
    <PackageReference Include="FluentAssertions.Analyzers" Version="0.34.1">
      <PrivateAssets>all</PrivateAssets>
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
    </PackageReference>
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\\{{Solution}}.Shared\\{{Solution}}.Shared.csproj" />
  </ItemGroup>

</Project>
`;

const TESTS_CSPROJ_CONTENT = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.Playwright" Version="1.55.0" />
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageReference Include="NUnit" Version="4.2.2" />
    <PackageReference Include="NUnit3TestAdapter" Version="4.6.0" />
    <!-- Pinned to 7.x: FluentAssertions 8.0+ ships under a commercial license. -->
    <PackageReference Include="FluentAssertions" Version="7.2.0" />
    <PackageReference Include="FluentAssertions.Analyzers" Version="0.34.1">
      <PrivateAssets>all</PrivateAssets>
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
    </PackageReference>
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\\{{Solution}}.Infrastructure\\{{Solution}}.Infrastructure.csproj" />
    <ProjectReference Include="..\\{{Solution}}.Shared\\{{Solution}}.Shared.csproj" />
  </ItemGroup>

  <ItemGroup>
    <None Update="appsettings.json">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </None>
  </ItemGroup>

</Project>
`;

// No "KeyVault" / "VaultUri" key here on purpose: SecretClientExtensions
// is not registered in the default architecture (see the Extensions block
// in buildDefaultArchitecture and the opt-in comment in
// SHARED_CSPROJ_CONTENT). Forks that re-enable the helper should add a
// matching "KeyVault": { "VaultUri": "" } entry to keep appsettings and
// the SecretClient wiring in sync.
// `Headless: true` is the default on purpose. The fixture launches a
// browser in `[SetUp]` for every test, so a headed default means a
// freshly exported solution pops a visible browser window open and shut
// on each test the moment you run `dotnet test` — startling, slow, and
// wrong for CI, which is where most first runs happen. Flip it to false
// in appsettings.json (or set the matching env var) when you want to
// watch a run locally.
const APPSETTINGS_CONTENT = JSON.stringify(
  {
    DefaultBrowser: "msedge",
    Headless: true,
    UseChromium: true,
    StartTracer: false,
    PlaywrightTimeout: 30000,
    Environment: "Local",
    Urls: {},
  },
  null,
  2,
);

// The C# default architecture intentionally does NOT include a `.vscode/`
// folder: scaffolded C# projects open in Visual Studio via the `.sln` and
// `.csproj` files below. The Python and Node.js scaffolds, which lack a
// native IDE project file, are the ones that ship `.vscode/` IDE config.
// The Java scaffolder writes a top-level `.vscode/` folder synthetically.
export function buildDefaultArchitecture(): Architecture {
  const sharedProject: ArchProject = {
    id: "default-shared",
    nameSuffix: ".Shared",
    isTestsProject: false,
    slnGuid: "{B1A2D3E4-5F60-4178-9ABC-DEF012345678}",
    files: [{ name: "{{Solution}}.Shared.csproj", content: SHARED_CSPROJ_CONTENT }],
    folders: [
      {
        name: "Helpers",
        folders: [],
        files: [
          { name: "TestContextHelper.cs", content: TEMPLATES.testContextHelper },
          { name: "TestOutputLogger.cs", content: TEMPLATES.testOutputLogger },
          { name: "TestTracker.cs", content: TEMPLATES.testTracker },
        ],
      },
      {
        name: "Configuration",
        folders: [],
        files: [
          { name: "TestConfig.cs", content: TEMPLATES.testConfig },
          { name: "Constants.cs", content: TEMPLATES.constants },
          {
            name: "AppConfigurationExtensions.cs",
            content: TEMPLATES.appConfigurationExtensions,
          },
        ],
      },
      {
        name: "Extensions",
        folders: [],
        // Azure Key Vault support is opt-in (see SHARED_CSPROJ_CONTENT
        // comment).
        files: [
          {
            name: "PlaywrightTraceExtensions.cs",
            content: TEMPLATES.playwrightTraceExtensions,
          },
        ],
      },
    ],
  };

  const infraProject: ArchProject = {
    id: "default-infra",
    nameSuffix: ".Infrastructure",
    isTestsProject: false,
    slnGuid: "{C3D8B9A1-4F5E-4E2C-9F3A-6B7D8E2F1C0A}",
    files: [
      { name: "{{Solution}}.Infrastructure.csproj", content: INFRA_CSPROJ_CONTENT },
    ],
    folders: [
      {
        name: "Fixtures",
        folders: [],
        files: [
          { name: "TestFixtureBase.cs", content: TEMPLATES.testFixtureBase },
          { name: "TestFixture.cs", content: TEMPLATES.testFixture },
        ],
      },
      {
        name: "Services",
        folders: [],
        files: [
          { name: "BrowserManager.cs", content: TEMPLATES.browserManager },
        ],
      },
      {
        name: "Interfaces",
        folders: [],
        files: [
          { name: "IBrowserManager.cs", content: TEMPLATES.iBrowserManager },
        ],
      },
    ],
  };

  const testsProject: ArchProject = {
    id: "default-tests",
    nameSuffix: ".Tests",
    isTestsProject: true,
    slnGuid: "{D4E5F6A7-8B90-41C2-B345-67890ABCDEF1}",
    files: [
      { name: "{{Solution}}.Tests.csproj", content: TESTS_CSPROJ_CONTENT },
      { name: "appsettings.json", content: APPSETTINGS_CONTENT },
    ],
    folders: [
      { name: "Tests", folders: [], files: [] },
      { name: "Constants", folders: [], files: [] },
      { name: "TestCategories", folders: [], files: [] },
      {
        name: "PageObjects",
        folders: [
          { name: "Interfaces", folders: [], files: [] },
          { name: "Selectors", folders: [], files: [] },
        ],
        files: [],
      },
    ],
  };

  return {
    id: DEFAULT_ARCHITECTURE_ID,
    name: "Default",
    isBuiltIn: true,
    projects: [infraProject, sharedProject, testsProject],
  };
}

export const DEFAULT_ARCHITECTURE: Architecture = {
  ...buildDefaultArchitecture(),
  language: "csharp",
  solutionType: "playwright",
};
