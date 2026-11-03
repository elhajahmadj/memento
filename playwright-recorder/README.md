# Playwright Test Builder

A full-stack tool for visually scaffolding **C# Playwright + NUnit** test automation projects without running any tests. Built with **ASP.NET Core 9** and **Angular 18**.

> The output of this tool is a real Visual Studio solution with valid, compilable C# code. The tool itself does **not** execute tests — it only scaffolds projects and records browser interactions to generate page object models and test methods.

## Repository Layout

```
playwright-recorder/
├── backend/                            ← ASP.NET Core 9 Web API + SignalR
│   ├── PlaywrightRecorder.sln
│   └── PlaywrightRecorder.Api/
│       ├── Program.cs
│       ├── appsettings.json
│       ├── Controllers/                ← REST endpoints
│       ├── Hubs/                       ← SignalR RecordingHub
│       ├── Models/                     ← DTOs
│       ├── Services/                   ← Project, FileTree, Codegen, Recording
│       └── Templates/                  ← TestFixture / IBrowserService / BrowserService
└── frontend/                           ← Angular 18 standalone + Angular Material
    ├── package.json
    ├── angular.json
    └── src/
        ├── main.ts
        ├── styles.scss                 ← VS Code-like dark theme
        └── app/
            ├── app.config.ts
            ├── app.component.*         ← Splash / Project Selection
            ├── components/             ← All UI panels and dialogs
            ├── services/               ← REST + SignalR clients
            └── models/
```

## Prerequisites

- **.NET 9 SDK** — https://dotnet.microsoft.com/download
- **Node.js 20+** and **npm 10+**
- **Angular CLI 18+** (optional, for `ng` commands): `npm i -g @angular/cli@18`
- **Microsoft Playwright browsers** (only required if you want to actually drive a browser during recording — see "Recording Mode" below).

## Run It Locally

### 1. Start the backend

```bash
cd backend/PlaywrightRecorder.Api
dotnet restore
dotnet run
```

The API listens on `http://localhost:5050` by default (configured in `Properties/launchSettings.json`). SignalR hub is at `http://localhost:5050/hubs/recording`.

### 2. Start the frontend

```bash
cd frontend
npm install
npm start
```

Angular dev server runs at `http://localhost:4200` and proxies `/api` and `/hubs` to the backend via `proxy.conf.json`.

Open `http://localhost:4200` in your browser. You'll see the splash screen with **New Project** and **Existing Project** options.

## Configuration — `appsettings.json`

All configurable paths and defaults live in `backend/PlaywrightRecorder.Api/appsettings.json`:

```json
{
  "TemplateFiles": {
    "TestFixturePath": "Templates/TestFixture.cs",
    "IBrowserServicePath": "Templates/IBrowserService.cs",
    "BrowserServicePath": "Templates/BrowserService.cs"
  },
  "DefaultBrowser": "Edge",
  "OutputBasePath": "C:/Projects",
  "Cors": {
    "AllowedOrigins": [ "http://localhost:4200" ]
  }
}
```

Adjust `OutputBasePath` to wherever you want scaffolded solutions to land by default. The user can also pick any directory in the **New Project** dialog.

## What The Generated C# Solution Looks Like

```
SolutionName/
├── SolutionName.sln
└── TestProjectName/
    ├── TestProjectName.csproj           ← Microsoft.Playwright + NUnit + Test SDK
    ├── appsettings.json
    ├── Base/TestFixture.cs              ← injected from Templates/
    ├── Services/
    │   ├── IBrowserService.cs           ← injected from Templates/
    │   └── BrowserService.cs            ← injected from Templates/
    ├── Tests/                           ← generated [TestFixture] classes
    └── PageObjects/
        ├── LoginPage.cs                 ← generated per page
        └── Selectors/
            └── LoginPageSelectors.cs    ← static selector constants
```

Open the `.sln` directly in Visual Studio 2022/2024 — it builds and runs as-is.

## Recording Mode

The backend integrates **Microsoft.Playwright** to drive a real Microsoft Edge instance and capture user interactions. When you click **Start Recording**:

1. Backend launches Edge via `BrowserService` (non-headless).
2. Page interactions (click, fill, navigate) are captured by Playwright's event hooks.
3. Each action is pushed to the Angular client over SignalR (`RecordingHub`).
4. Element selectors are resolved with the priority: `data-testid` → `id` → `aria-label` → CSS fallback.
5. On **Stop Recording**, the backend writes:
   - A new test method into the selected `[TestFixture]` class.
   - One `PageObjects/<PageName>.cs` + `PageObjects/Selectors/<PageName>Selectors.cs` per visited page.

> **Browser preview**: The Angular UI shows screenshots streamed from the backend at ~10 fps over SignalR (`screenshotFrame` event) instead of an embedded iframe — Edge can't be embedded into an Angular app due to cross-origin restrictions, so screenshot streaming is the standard approach.

To enable recording locally, after `dotnet restore`, install the Playwright browser binaries once:

```bash
cd backend/PlaywrightRecorder.Api
pwsh bin/Debug/net9.0/playwright.ps1 install msedge
```

## Backend API Surface

| Method | Path                        | Purpose                                  |
|--------|-----------------------------|------------------------------------------|
| POST   | `/api/project/new`          | Scaffold a new VS solution               |
| POST   | `/api/project/load`         | Load an existing `.sln`                  |
| GET    | `/api/project/tree`         | Return project folder/file tree          |
| POST   | `/api/files/create`         | Create a `.cs` file                      |
| GET    | `/api/files/content`        | Read file contents                       |
| PUT    | `/api/files/update`         | Update file content                      |
| DELETE | `/api/files/delete`         | Delete a file                            |
| POST   | `/api/files/rename`         | Rename a file                            |
| POST   | `/api/folders/create`       | Create a folder                          |
| DELETE | `/api/folders/delete`       | Delete a folder                          |
| POST   | `/api/recording/start`      | Start a Playwright session               |
| POST   | `/api/recording/stop`       | Stop and finalize recording              |
| POST   | `/api/codegen/testclass`    | Generate a `[TestFixture]` class file    |
| POST   | `/api/codegen/pageobject`   | Generate `PageObject` + `Selectors` pair |

SignalR hub: `/hubs/recording` — events: `actionRecorded`, `screenshotFrame`, `treeUpdated`, `recordingStopped`.

## Notes & Constraints

- All generated C# is namespaced from the project's chosen default namespace — there are no hard-coded namespaces in templates. Templates use the `{Namespace}` placeholder which is rewritten on injection.
- The app does not execute any tests. It scaffolds projects, edits files, and generates code.
- Confirmation dialogs are shown before any destructive operation (delete file/folder).
- Toast notifications are shown via Angular Material `MatSnackBar` for every file operation.
