/**
 * Node.js `.vscode/` configuration shipped with the default Node.js
 * architecture. Workspace TS SDK plus a "Playwright: run current spec"
 * / "Playwright: run all tests" debug profile so F5 works on a fresh
 * download.
 */

export const NODEJS_VSCODE_SETTINGS_CONTENT = `${JSON.stringify(
  {
    "typescript.tsdk": "node_modules/typescript/lib",
    "typescript.enablePromptUseWorkspaceTsdk": true,
    "editor.formatOnSave": false,
  },
  null,
  2,
)}\n`;

export const NODEJS_VSCODE_LAUNCH_CONTENT = `${JSON.stringify(
  {
    version: "0.2.0",
    configurations: [
      {
        name: "Playwright: run current spec",
        type: "node",
        request: "launch",
        runtimeExecutable: "npx",
        runtimeArgs: ["playwright", "test", "${relativeFile}"],
        cwd: "${workspaceFolder}",
        console: "integratedTerminal",
        skipFiles: ["<node_internals>/**"],
      },
      {
        name: "Playwright: run all tests",
        type: "node",
        request: "launch",
        runtimeExecutable: "npx",
        runtimeArgs: ["playwright", "test"],
        cwd: "${workspaceFolder}",
        console: "integratedTerminal",
        skipFiles: ["<node_internals>/**"],
      },
    ],
  },
  null,
  2,
)}\n`;

export const NODEJS_VSCODE_EXTENSIONS_CONTENT = `${JSON.stringify(
  {
    recommendations: [
      "ms-playwright.playwright",
      "dbaeumer.vscode-eslint",
      "esbenp.prettier-vscode",
    ],
  },
  null,
  2,
)}\n`;
