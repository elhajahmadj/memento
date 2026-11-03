import fs from "node:fs/promises";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { ApiScaffoldResult } from "@/features/projects/infrastructure/apiCsharpScaffolder";

/**
 * Folder name of the per-solution helper "package" (mirrors C#'s
 * `{Sln}.Automation.API`). Kept stable across solutions because Python
 * imports are package-relative, not solution-relative.
 */
export const API_PYTHON_HELPER_DIR = "automation_api";

/**
 * Folder name of the per-solution test "package" (mirrors C#'s
 * `{Sln}.Automation.API.Tests`). Stored as the `testProjectName` on the
 * Project record so generic helpers like `listApiBaseUrls` keep working
 * — they read `<rootPath>/<testProjectName>/appsettings.json`.
 */
export const API_PYTHON_TESTS_DIR = "tests";

function pyprojectToml(solutionName: string): string {
  return `[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "${solutionName.toLowerCase()}"
version = "0.0.0"
description = "${solutionName} API test solution (pytest + httpx)"
requires-python = ">=3.10"
dependencies = [
    "httpx>=0.27",
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
]

[tool.setuptools]
packages = ["${API_PYTHON_HELPER_DIR}"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["${API_PYTHON_TESTS_DIR}"]
# Recognize the cross-language naming convention {ClassName}Tests in
# addition to pytest's default "Test*" so generated classes are
# collected. Method discovery still requires the default "test_*"
# prefix, which the codegen always emits.
python_classes = ["Test*", "*Tests"]
`;
}

function conftestPy(): string {
  return `"""
Root pytest config. Adds the project root to sys.path so the
'automation_api' helper package and the local 'tests' package both
import cleanly without requiring an editable install.
"""
import os
import sys

_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# Register the shared API test fixture module so generated test classes
# can request 'api_fixture' without each test file importing it.
pytest_plugins = ("${API_PYTHON_TESTS_DIR}.infrastructure.api_test_collection",)
`;
}

function helperInit(): string {
  return `"""
${API_PYTHON_HELPER_DIR}: shared helpers for API tests (constants,
fixtures, transports, configuration extensions). Mirrors the C#
'{Sln}.Automation.API' library layout.
"""
`;
}

export function apiEndpointsPy(): string {
  return `"""
Endpoint route constants. Build Test → AssistantBuilder appends new
attributes (or nested classes) here atomically. The class is intentionally
empty at scaffold time — every entry is added through the upsert path so
the file format stays predictable.
"""


class ApiEndpoints:
    pass
`;
}

function testCollectionsPy(): string {
  return `"""
Canonical pytest "collection" / marker names. Generated test classes use
\`pytestmark = pytest.mark.api\` to opt in to the shared fixture wiring.
"""


class TestCollections:
    Api = "api"
`;
}

function apiTestOptionsPy(): string {
  return `"""
Strongly-typed binding for the per-environment URL block in
'appsettings.json' under 'ApiTest:Urls:{urlName}'. Mirrors the C#
'ApiTestOptions' record so the on-disk config format is identical
across languages.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class ApiTestOptions:
    base_url: str = ""
`;
}

function apiTestFixturePy(): string {
  return `"""
Shared API test fixture. URL blocks live under
'ApiTest:Urls:{urlName}' in 'appsettings.json'; 'get_client' resolves
the right 'httpx.AsyncClient' lazily per name, with retry + logging
transports attached. Mirrors the C# 'ApiTestFixture'.
"""
import json
import os
from typing import Dict

import httpx

from ${API_PYTHON_HELPER_DIR}.handlers.http_logging_handler import HttpLoggingHandler
from ${API_PYTHON_HELPER_DIR}.handlers.retry_handler import RetryHandler
from ${API_PYTHON_HELPER_DIR}.infrastructure.api_test_options import ApiTestOptions


class ApiTestFixture:
    """Lifecycle-managed HTTP client cache, one per URL name."""

    def __init__(self, appsettings_path: str | None = None) -> None:
        if appsettings_path is None:
            # Resolve to '<rootPath>/${API_PYTHON_TESTS_DIR}/appsettings.json'.
            here = os.path.dirname(os.path.abspath(__file__))
            appsettings_path = os.path.normpath(
                os.path.join(here, "..", "..", "${API_PYTHON_TESTS_DIR}", "appsettings.json")
            )
        with open(appsettings_path, "r", encoding="utf-8") as fh:
            self._configuration = json.load(fh)
        self._clients: Dict[str, httpx.AsyncClient] = {}

    @property
    def configuration(self) -> dict:
        return self._configuration

    def get_options(self, url_name: str) -> ApiTestOptions:
        urls = (self._configuration.get("ApiTest") or {}).get("Urls") or {}
        block = urls.get(url_name)
        if not block or not block.get("BaseUrl"):
            raise RuntimeError(
                f"appsettings.json is missing ApiTest:Urls:{url_name}:BaseUrl"
            )
        return ApiTestOptions(base_url=block["BaseUrl"])

    def get_client(self, url_name: str) -> httpx.AsyncClient:
        existing = self._clients.get(url_name)
        if existing is not None:
            return existing
        options = self.get_options(url_name)
        inner = httpx.AsyncHTTPTransport()
        logging = HttpLoggingHandler(inner)
        retry = RetryHandler(logging)
        client = httpx.AsyncClient(base_url=options.base_url, transport=retry)
        self._clients[url_name] = client
        return client

    async def aclose(self) -> None:
        for client in self._clients.values():
            await client.aclose()
        self._clients.clear()
`;
}

function retryTransportPy(): string {
  return `"""
Retries transient HTTP failures (5xx + 408 + 429) with exponential backoff.
Mirrors the C# 'RetryHandler'.
"""
import asyncio

import httpx


class RetryHandler(httpx.AsyncBaseTransport):
    def __init__(
        self,
        inner: httpx.AsyncBaseTransport,
        max_retries: int = 3,
        base_delay_ms: int = 200,
    ) -> None:
        self._inner = inner
        self._max_retries = max_retries
        self._base_delay_ms = base_delay_ms

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        attempt = 0
        while True:
            response = await self._inner.handle_async_request(request)
            if attempt >= self._max_retries or not self._should_retry(response.status_code):
                return response
            await response.aclose()
            delay_s = (self._base_delay_ms * (2 ** attempt)) / 1000.0
            await asyncio.sleep(delay_s)
            attempt += 1

    @staticmethod
    def _should_retry(status_code: int) -> bool:
        return status_code >= 500 or status_code == 408 or status_code == 429

    async def aclose(self) -> None:
        await self._inner.aclose()
`;
}

function loggingTransportPy(): string {
  return `"""
Logs every request/response line via Python's 'logging' module so test
runners and CI dashboards both capture the trail. Mirrors the C#
'HttpLoggingHandler'.
"""
import logging
import time

import httpx

_log = logging.getLogger("api.http")


class HttpLoggingHandler(httpx.AsyncBaseTransport):
    def __init__(self, inner: httpx.AsyncBaseTransport) -> None:
        self._inner = inner

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        started = time.monotonic()
        _log.info("[HTTP] -> %s %s", request.method, request.url)
        try:
            response = await self._inner.handle_async_request(request)
            elapsed_ms = int((time.monotonic() - started) * 1000)
            _log.info(
                "[HTTP] <- %s %s %s (%dms)",
                response.status_code,
                request.method,
                request.url,
                elapsed_ms,
            )
            return response
        except Exception as ex:  # pragma: no cover — diagnostic path
            elapsed_ms = int((time.monotonic() - started) * 1000)
            _log.error(
                "[HTTP] !! %s %s threw %s after %dms",
                request.method,
                request.url,
                type(ex).__name__,
                elapsed_ms,
            )
            raise

    async def aclose(self) -> None:
        await self._inner.aclose()
`;
}

function configurationExtensionsPy(): string {
  return `"""
Configuration helpers for API tests. 'get_access_token' is a mock by
default — production deployments are expected to replace its body with a
real token-mint call (e.g. against an IDP) before running authenticated
tests. Mirrors the C# 'ConfigurationExtensions'.
"""


def get_access_token(configuration: dict, url_name: str) -> str:
    urls = (configuration.get("ApiTest") or {}).get("Urls") or {}
    block = urls.get(url_name) or {}
    return block.get("AccessToken") or "mock-access-token"
`;
}

function apiTestCollectionPy(): string {
  return `"""
Pytest-side wiring for the shared ApiTestFixture. Generated test classes
mark themselves with 'pytestmark = pytest.mark.api' and receive
'api_fixture' via the session-scoped fixture below.
"""
import asyncio

import pytest

from ${API_PYTHON_HELPER_DIR}.infrastructure.api_test_fixture import ApiTestFixture


@pytest.fixture(scope="session")
def api_fixture() -> ApiTestFixture:
    fixture = ApiTestFixture()
    yield fixture
    asyncio.get_event_loop().run_until_complete(fixture.aclose())
`;
}

function appsettingsJson(): string {
  return `${JSON.stringify({ ApiTest: { Urls: {} } }, null, 2)}\n`;
}

/**
 * Scaffold a brand-new Python pytest + httpx API test solution. Layout:
 *
 *   {Sln}/                                   ← rootPath
 *     pyproject.toml                         ← slnPath (project marker file)
 *     .testbuilder.json                      ← solutionType: "api" (written by caller)
 *     conftest.py
 *     automation_api/
 *       __init__.py
 *       constants/{__init__,api_endpoints,test_collections}.py
 *       infrastructure/{__init__,api_test_fixture,api_test_options}.py
 *       handlers/{__init__,retry_handler,http_logging_handler}.py
 *       extensions/{__init__,configuration_extensions}.py
 *     tests/                                  ← testProjectName
 *       __init__.py
 *       appsettings.json
 *       infrastructure/{__init__,api_test_collection}.py
 *       api_testing_assistants/__init__.py   ← Build Test appends here
 *       tests/__init__.py                    ← test_*.py classes land here
 */
export async function scaffoldApiPython(
  solutionName: string,
  _namespace: string,
): Promise<ApiScaffoldResult> {
  await fs.mkdir(recorderConfig.workspaceDir, { recursive: true });
  const rootPath = path.join(recorderConfig.workspaceDir, solutionName);
  await fs.mkdir(rootPath, { recursive: true });

  const helperDir = safeJoin(rootPath, API_PYTHON_HELPER_DIR);
  const testsDir = safeJoin(rootPath, API_PYTHON_TESTS_DIR);

  await fs.writeFile(path.join(rootPath, "pyproject.toml"), pyprojectToml(solutionName));
  await fs.writeFile(path.join(rootPath, "conftest.py"), conftestPy());

  // --- helper package ---
  await fs.mkdir(safeJoin(helperDir, "constants"), { recursive: true });
  await fs.mkdir(safeJoin(helperDir, "infrastructure"), { recursive: true });
  await fs.mkdir(safeJoin(helperDir, "handlers"), { recursive: true });
  await fs.mkdir(safeJoin(helperDir, "extensions"), { recursive: true });

  await fs.writeFile(safeJoin(helperDir, "__init__.py"), helperInit());
  await fs.writeFile(safeJoin(helperDir, "constants/__init__.py"), "");
  await fs.writeFile(safeJoin(helperDir, "constants/api_endpoints.py"), apiEndpointsPy());
  await fs.writeFile(
    safeJoin(helperDir, "constants/test_collections.py"),
    testCollectionsPy(),
  );
  await fs.writeFile(safeJoin(helperDir, "infrastructure/__init__.py"), "");
  await fs.writeFile(
    safeJoin(helperDir, "infrastructure/api_test_options.py"),
    apiTestOptionsPy(),
  );
  await fs.writeFile(
    safeJoin(helperDir, "infrastructure/api_test_fixture.py"),
    apiTestFixturePy(),
  );
  await fs.writeFile(safeJoin(helperDir, "handlers/__init__.py"), "");
  await fs.writeFile(
    safeJoin(helperDir, "handlers/retry_handler.py"),
    retryTransportPy(),
  );
  await fs.writeFile(
    safeJoin(helperDir, "handlers/http_logging_handler.py"),
    loggingTransportPy(),
  );
  await fs.writeFile(safeJoin(helperDir, "extensions/__init__.py"), "");
  await fs.writeFile(
    safeJoin(helperDir, "extensions/configuration_extensions.py"),
    configurationExtensionsPy(),
  );

  // --- tests package ---
  await fs.mkdir(safeJoin(testsDir, "infrastructure"), { recursive: true });
  await fs.mkdir(safeJoin(testsDir, "api_testing_assistants"), { recursive: true });
  await fs.mkdir(safeJoin(testsDir, "tests"), { recursive: true });

  await fs.writeFile(safeJoin(testsDir, "__init__.py"), "");
  await fs.writeFile(safeJoin(testsDir, "appsettings.json"), appsettingsJson());
  await fs.writeFile(safeJoin(testsDir, "infrastructure/__init__.py"), "");
  await fs.writeFile(
    safeJoin(testsDir, "infrastructure/api_test_collection.py"),
    apiTestCollectionPy(),
  );
  await fs.writeFile(safeJoin(testsDir, "api_testing_assistants/__init__.py"), "");
  await fs.writeFile(safeJoin(testsDir, "tests/__init__.py"), "");

  // Per-suite Test Categories live under `tests/test_categories/` so the
  // recording-driven Python codegen can drop `{snake}_categories.py`
  // files alongside the generated test classes. Pre-create the package
  // marker so the directory is importable from day one — categories
  // files are upserted on demand.
  await fs.mkdir(safeJoin(testsDir, "test_categories"), { recursive: true });
  await fs.writeFile(safeJoin(testsDir, "test_categories/__init__.py"), "");

  return {
    rootPath,
    slnPath: path.join(rootPath, "pyproject.toml"),
    helperProjectName: API_PYTHON_HELPER_DIR,
    testProjectName: API_PYTHON_TESTS_DIR,
  };
}
