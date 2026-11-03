/**
 * Python `.vscode/` configuration shipped with the default Python
 * architecture. Picks the local `.venv` interpreter, enables pytest
 * discovery against `tests/`, and ships a "Pytest: current file" /
 * "Pytest: all tests" debug profile so F5 works on a fresh download.
 *
 * Interpreter selection is intentionally OS-agnostic: we set
 * `python.venvPath` to `${workspaceFolder}` so the Python extension
 * auto-discovers `<workspace>/.venv/` and selects the right binary
 * inside (POSIX `.venv/bin/python` or Windows `.venv\Scripts\python.exe`)
 * without hard-coding a path that only resolves on one OS.
 */

export const PYTHON_VSCODE_SETTINGS_CONTENT = `${JSON.stringify(
  {
    "python.venvPath": "${workspaceFolder}",
    "python.venvFolders": [".venv", "venv"],
    "python.testing.pytestEnabled": true,
    "python.testing.unittestEnabled": false,
    "python.testing.pytestArgs": ["tests"],
    "python.terminal.activateEnvironment": true,
  },
  null,
  2,
)}\n`;

export const PYTHON_VSCODE_LAUNCH_CONTENT = `${JSON.stringify(
  {
    version: "0.2.0",
    configurations: [
      {
        name: "Pytest: current file",
        type: "debugpy",
        request: "launch",
        module: "pytest",
        args: ["${file}"],
        console: "integratedTerminal",
        cwd: "${workspaceFolder}",
        justMyCode: false,
      },
      {
        name: "Pytest: all tests",
        type: "debugpy",
        request: "launch",
        module: "pytest",
        args: ["tests"],
        console: "integratedTerminal",
        cwd: "${workspaceFolder}",
        justMyCode: false,
      },
    ],
  },
  null,
  2,
)}\n`;

export const PYTHON_VSCODE_EXTENSIONS_CONTENT = `${JSON.stringify(
  {
    recommendations: ["ms-python.python", "ms-playwright.playwright"],
  },
  null,
  2,
)}\n`;
