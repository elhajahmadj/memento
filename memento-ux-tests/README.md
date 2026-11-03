# Memento.UxTests

End-to-end UX test suite for the **memento** Playwright Test Builder, written in
C# .NET 8 with NUnit and Microsoft.Playwright. The project layout, fixture
hierarchy and helper surface deliberately mirror the C# *Default* architecture
that memento itself emits when you record a new project — so this suite reads
like one of memento's own outputs.

```
memento-ux-tests/
├── Memento.UxTests.sln
├── global.json                       # pins .NET SDK to 8.x
├── Memento.UxTests.Shared/           # config + helpers (no Playwright deps)
│   ├── Configuration/Constants.cs
│   ├── Configuration/MementoSettings.cs
│   ├── Configuration/AppConfigurationExtensions.cs
│   ├── Helpers/{TestOutputLogger,TestContextHelper,TestTracker}.cs
│   └── Extensions/PlaywrightTraceExtensions.cs
├── Memento.UxTests.Infrastructure/   # browser lifecycle + DI container
│   ├── Interfaces/IBrowserManager.cs
│   ├── Services/BrowserManager.cs
│   ├── Fixtures/{TestFixtureBase,TestFixture,RoleFixture}.cs
│   ├── Auth/RoleSession.cs
│   ├── Api/MementoApiClient.cs
│   └── Data/TestDataFactory.cs
└── Memento.UxTests.Tests/            # the actual NUnit tests
    ├── appsettings.json
    ├── PageObjects/
    │   ├── PageObjectBase.cs
    │   ├── Selectors/                # data-testid string constants
    │   ├── Interfaces/               # I<Page>Actions interfaces
    │   └── Actions/                  # concrete page-object Actions classes
    └── Tests/                        # one file per feature area
```

## Prerequisites

- **.NET 8 SDK** (the repo pins via `global.json`)
- A running memento app reachable at `BaseUrl` (defaults to `http://localhost:80`,
  the workspace's shared proxy) with the seeded `AdminRole` / `LimitedAdminRole`
  / `UserRole` accounts (seed password `Temporary1!`)

```bash
dotnet --version           # should report 8.x
dotnet restore             # one-time per machine
pwsh bin/Debug/net8.0/playwright.ps1 install   # download browsers
```

## Run

```bash
# everything
dotnet test --logger "trx;LogFileName=memento-ux.trx"

# only the functional layer (skip a11y / perf / visual / resilience)
dotnet test --filter "TestCategory=Functional"

# only one fixture
dotnet test --filter "FullyQualifiedName~AssertionCatalogTests"

# headed mode for local debugging
MEMENTO_UX_RunHeadless=false dotnet test
```

The `trx` logger is the canonical pipeline output. Screenshots, traces and
visual snapshots all attach themselves to their owning test in the `.trx` so
they show up directly in Azure DevOps / GitHub Actions test reports.

## Configuration

Settings flow through three layers (highest precedence first):

1. **Environment variables prefixed `MEMENTO_UX_`**
   `MEMENTO_UX_BaseUrl=https://memento.example.com`
   `MEMENTO_UX_RunHeadless=false`
   `MEMENTO_UX_Roles__Admin__Username=qa-admin`
2. **`appsettings.local.json`** — committed-out, per-developer overrides.
3. **`appsettings.json`** — committed defaults (BaseUrl `http://localhost:80`,
   role usernames `AdminRole` / `LimitedAdminRole` / `UserRole`, password
   `Temporary1!`).

| Key                    | Default               | Notes                                                                 |
|------------------------|-----------------------|-----------------------------------------------------------------------|
| `BaseUrl`              | `http://localhost:80` | Memento root URL                                                      |
| `Environment`          | `Local`               | `Local` enables IsLocalEnv() shortcuts (no trace upload, etc.)        |
| `DefaultBrowser`       | `chromium`            | `chromium` / `firefox` / `webkit` / `chrome` / `msedge` / `msedge-beta` |
| `UseChromium`          | `true`                | Force Chromium, ignore `DefaultBrowser`                               |
| `RunHeadless`          | `true`                |                                                                       |
| `StartTracer`          | `false`               | Force Playwright trace on every test                                  |
| `PlaywrightTimeout`    | `30000`               | ms                                                                    |
| `Roles:Admin:*`        | `AdminRole/Temporary1!` | Same shape for `LimitedAdmin` and `User`                            |

## Architecture mirrors memento

| Memento Default emit                       | This suite                                   |
|--------------------------------------------|----------------------------------------------|
| `*.Shared/Configuration/Constants.cs`      | `Memento.UxTests.Shared/Configuration/Constants.cs` |
| `*.Shared/Configuration/TestConfig.cs`     | `…/Configuration/MementoSettings.cs` (renamed; adds BaseUrl + Roles) |
| `*.Shared/Helpers/TestContextHelper.cs`    | identical                                    |
| `*.Shared/Helpers/TestOutputLogger.cs`     | identical                                    |
| `*.Shared/Helpers/TestTracker.cs`          | identical                                    |
| `*.Infrastructure/Interfaces/IBrowserManager.cs` | identical contract                     |
| `*.Infrastructure/Services/BrowserManager.cs`    | identical engine routing                |
| `*.Infrastructure/Fixtures/TestFixtureBase.cs`   | identical                               |
| `*.Infrastructure/Fixtures/TestFixture.cs`       | identical lazy-DI ProcessExit pattern   |

This suite adds, on top of the Default architecture:

- **`Auth/RoleSession`** — caches one Playwright storage-state JSON per role so
  every test starts already signed in. Sign-in itself goes through the real
  `/login` form (not the dev-only `/auth/dev-login` shortcut), so the suite
  works against production-style builds too.
- **`Fixtures/RoleFixture`** + `AdminFixture` / `LimitedAdminFixture` /
  `UserFixture` — concrete fixture bases that wire `BuildContextOptions()` to
  the cached storage and navigate to `StartPath` before each test.
- **`Api/MementoApiClient`** — a thin HTTP helper for setup/teardown that does
  *not* short-circuit assertions (assertions remain on the UI through page
  objects).
- **Non-functional layers**:
  - `Tests/Accessibility/*` (Deque.AxeCore.Playwright)
  - `Tests/Performance/*` (wall-clock smoke thresholds)
  - `Tests/Visual/*` (full-page screenshots attached as test artifacts)
  - `Tests/Resilience/*` (route interception + slow-network simulation)

## Page Object discipline

`[Test]` methods may **never** call `page.Locator(...)` directly. All UI
interactions go through an `Actions` class that resolves selectors from the
matching `Selectors` static. This is the same discipline the recorder enforces
in its emitted code; keeping the suite aligned makes it trivial to adopt new
recordings produced by memento itself.

## Adding a test

1. Add the missing `data-testid` constant to `PageObjects/Selectors/<Page>Selectors.cs`.
2. Add the method to `PageObjects/Interfaces/I<Page>Actions.cs`.
3. Implement it in `PageObjects/Actions/<Page>.cs`.
4. Write the `[Test]` in `Tests/<Area>Tests.cs`, using the new Actions method.

## CI

Pipeline step skeleton (pseudo-YAML; works on Azure DevOps / GitHub Actions
with trivial syntax adjustments):

```yaml
- script: |
    dotnet restore memento-ux-tests
    dotnet build  memento-ux-tests --no-restore -c Release
    pwsh memento-ux-tests/Memento.UxTests.Tests/bin/Release/net8.0/playwright.ps1 install --with-deps
    dotnet test memento-ux-tests --no-build -c Release \
      --logger "trx;LogFileName=memento-ux.trx" \
      --results-directory $(Agent.TempDirectory)/TestResults
  env:
    MEMENTO_UX_BaseUrl:    https://memento.qa.example.com
    MEMENTO_UX_RunHeadless: "true"
- task: PublishTestResults@2
  inputs:
    testResultsFormat: VSTest
    testResultsFiles:  '**/memento-ux.trx'
```
