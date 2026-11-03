/**
 * Python default architecture file templates.
 *
 * Inlined here as raw string constants rather than under
 * `lib/templates/` because the Python templates are short and only used
 * by this single architecture. `{{Package}}`, `{{TestPackage}}`, and
 * `{{Solution}}` are substituted by the project scaffolder (see
 * `applyTokens` in `templates.ts`).
 *
 * Feature parity with the C# default (Task #6):
 *   - Infrastructure/Fixtures/TestFixtureBase  → infrastructure/test_fixture_base.py
 *   - Infrastructure/Services/BrowserManager   → infrastructure/browser_manager.py
 *   - Shared/Helpers/TestContextHelper         → shared/test_context_helper.py
 *   - Shared/Helpers/TestOutputLogger          → shared/test_output_logger.py
 *   - Shared/Helpers/TestTracker               → shared/test_tracker.py
 *   - Shared/Configuration/TestConfig          → shared/test_config.py
 *   - Shared/Configuration/Constants           → shared/constants.py
 *   - Shared/Configuration/AppConfigurationExtensions
 *                                              → shared/app_configuration.py
 *   - Shared/Extensions/PlaywrightTraceExtensions
 *                                              → shared/playwright_trace_extensions.py
 *   - appsettings.json + tracing/screenshot wiring
 *                                              → conftest.py + .env.example
 * Tracing is opted into per-run by setting `START_TRACER=1` (or
 * `{{Solution}}_START_TRACER=true`) in the environment, by toggling
 * `start_tracer = true` in `.env`, or by tagging an individual test with
 * `@pytest.mark.start_tracer`.
 */

export const PYTHON_PYPROJECT_CONTENT = `[project]
name = "{{Package}}"
version = "0.1.0"
description = "Playwright + pytest test suite for {{Solution}}"
requires-python = ">=3.10"
dependencies = [
  "playwright>=1.55.0",
  "pytest>=8.3.0",
  "pytest-playwright>=0.5.2",
  "python-dotenv>=1.0.0",
]

[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

# The scaffold uses a flat layout with multiple top-level packages, which
# defeats setuptools' auto-discovery (it refuses with "Multiple top-level
# packages discovered in a flat-layout."). List them explicitly so
# \`pip install -e .\` works out of the box.
[tool.setuptools.packages.find]
where = ["."]
include = ["tests*", "pages*", "shared*", "infrastructure*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
markers = [
  "start_tracer: force-enable Playwright tracing for this test",
]
`;

export const PYTHON_REQUIREMENTS_CONTENT = `playwright>=1.55.0
pytest>=8.3.0
pytest-playwright>=0.5.2
python-dotenv>=1.0.0
`;

export const PYTHON_GITIGNORE_CONTENT = `__pycache__/
*.py[cod]
*.egg-info/
.pytest_cache/
.venv/
venv/
test-results/
playwright-report/
playwright-traces/
.env
.env.local
`;

export const PYTHON_README_CONTENT = `# {{Solution}}

Playwright + pytest test suite scaffolded by Test Builder.

## Setup

\`\`\`
pip install -e .
playwright install
\`\`\`

## Run tests

\`\`\`
pytest
\`\`\`

## Tracing

Enable Playwright tracing for an entire run by setting \`START_TRACER=1\` (or
\`{{Solution}}_START_TRACER=true\`) in the environment or in \`.env\`. To opt
in for a single test, decorate it with \`@pytest.mark.start_tracer\`.
Failed tests automatically attach a screenshot under \`test-results/\`.
`;

export const PYTHON_ENV_EXAMPLE_CONTENT = `# Base URL the recorded suites navigate to. Override per environment.
{{Solution}}_BASE_URL=https://example.com

# Per-named-URL overrides used by recorded suites. The recorder generates
# env-var names of the form <SOLUTION>_URL_<NAME>, e.g.:
#   {{Solution}}_URL_HOMEPAGE=https://example.com

# Browser selection (chromium / firefox / webkit / chromium channels like
# msedge / chrome).
{{Solution}}_BROWSER=chromium
{{Solution}}_USE_CHROMIUM=true
{{Solution}}_HEADLESS=false

# Force-enable Playwright tracing for every test in the run.
START_TRACER=0

# Active environment label (Local / Dev / QA / Prod). When unset (or
# Local / Development) the trace upload hook is skipped.
{{Solution}}_ENVIRONMENT=Local
`;

export const PYTHON_INIT_CONTENT = "";

// Trivial sample test that ships in `tests/` so a freshly downloaded
// scaffold has something to run. F5 in VS Code (the "Pytest: current
// file" launch profile) hits this file and produces a green pytest run
// instead of the confusing "no tests collected" message a user would
// otherwise see on a brand-new project. Uses the `page` fixture from
// `pytest-playwright` and navigates to `about:blank` so it never makes
// a network call.
export const PYTHON_TEST_SMOKE_CONTENT = `"""Sample smoke test shipped with the scaffold.

Visits \`about:blank\` so a freshly downloaded project produces a green
\`pytest\` run on the very first F5 in VS Code, before any suites have
been recorded. Safe to delete (or replace) once you record real tests.
"""
from playwright.sync_api import Page


def test_smoke(page: Page) -> None:
    page.goto("about:blank")
    assert page.url == "about:blank"
`;

export const PYTHON_CONFTEST_CONTENT = `"""Shared pytest fixtures for {{Solution}}.

Provides project-wide fixtures that play the role of NUnit's [OneTimeSetUp]
and [SetUp] hooks. Per-test-class hook fixtures live alongside each
\`test_*.py\` file.

This conftest also wires up the cross-cutting concerns that the C# default
architecture handles in \`TestFixture.SetUpAsync\` / \`TearDownAsync\`:

  * \`screenshot-on-failure\` via the \`pytest_runtest_makereport\` hook.
  * Playwright tracing started/stopped around each test when one of:
      - the env var \`START_TRACER\` (or \`{{Solution}}_START_TRACER\`) is truthy,
      - \`TestConfig.start_tracer\` resolves to True,
      - the test is tagged \`@pytest.mark.start_tracer\`.
  * \`TestTracker\` pass/skip counters per test.
"""
import os
import pytest

from infrastructure.browser_manager import BrowserManager
from shared.app_configuration import AppConfiguration
from shared.constants import Constants
from shared.test_config import TestConfig
from shared.test_context_helper import TestContextHelper
from shared.test_output_logger import TestOutputLogger
from shared.test_tracker import TestTracker

# Hydrate TestConfig once per session so fixtures and page objects can
# read settings through the typed surface instead of re-parsing
# environment variables / .env on every test.
_CONFIG = AppConfiguration.get_configuration()
AppConfiguration.load_test_config(_CONFIG)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        f"{Constants.START_TRACER}: force-enable Playwright tracing for this test",
    )


@pytest.fixture(scope="session")
def base_url() -> str:
    """Base URL all recorded navigations resolve against."""
    return TestConfig.urls.get("BaseUrl") or os.environ.get(
        "{{Solution}}_BASE_URL", "https://example.com"
    )


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    """Default Playwright browser context arguments for the suite."""
    return {
        **browser_context_args,
        "viewport": {"width": 1280, "height": 720},
        "ignore_https_errors": True,
    }


@pytest.fixture
def _browser_manager() -> BrowserManager:
    """Per-test BrowserManager — owns the trace + screenshot helpers."""
    return BrowserManager()


@pytest.fixture(autouse=True)
def _tracing(request, context, page, _browser_manager):
    """Start/stop a Playwright trace for tests that opt in.

    Mirrors the C# \`TestFixture\` block that calls
    \`_browserManager.StartTracingAsync()\` in SetUp and
    \`StopTracingAsync()\` in TearDown.
    """
    should_trace = (
        TestConfig.start_tracer
        or os.environ.get("START_TRACER", "").strip().lower() in {"1", "true", "yes"}
        or request.node.get_closest_marker(Constants.START_TRACER) is not None
    )
    if should_trace:
        _browser_manager.start_tracing(context, request.node.name)
    yield
    if should_trace:
        _browser_manager.stop_tracing(
            context,
            page,
            upload=not AppConfiguration.is_local_env(),
            logger=TestOutputLogger(),
            test_name=request.node.name,
        )


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """Attach a screenshot when a test fails and tally pass/skip totals."""
    outcome = yield
    report = outcome.get_result()
    setattr(item, f"rep_{report.when}", report)
    if report.when != "call":
        return
    helper = TestContextHelper(item, report)
    logger = TestOutputLogger()
    if report.failed:
        logger.log_test_failed_data(helper)
        page = item.funcargs.get("page")
        if page is not None:
            BrowserManager().take_screenshot(page, logger, helper.method_name)
    elif report.passed:
        TestTracker.count_passing_tests()
    elif report.skipped:
        TestTracker.count_skipped_tests()
`;

export const PYTHON_TEST_FIXTURE_BASE_CONTENT = `"""Base test class shared by every recorded test class.

Mirrors the role of \`{{Namespace}}.Infrastructure.Fixtures.TestFixtureBase\`
in the C# default architecture: a single attachment point for hook
fixtures and helper methods that every test in the suite inherits. The
shared cross-cutting concerns (screenshot-on-failure, tracing,
TestTracker counts) are wired in \`conftest.py\` so this base stays
focused on per-class state and convenience accessors.
"""
from typing import Optional

from shared.app_configuration import AppConfiguration
from shared.test_config import TestConfig
from shared.test_output_logger import TestOutputLogger

try:  # pragma: no cover - optional dependency
    from faker import Faker  # type: ignore
except Exception:  # pragma: no cover - faker is optional
    Faker = None  # type: ignore[assignment]


class TestFixtureBase:
    """Base class — extend this in every \`Test<Class>\` you record.

    Holds the shared, process-wide state every concrete test class needs
    so per-test fixtures only have to manage per-test state. The
    Playwright \`page\`/\`context\`/\`browser\` are provided by
    pytest-playwright fixtures and don't need to live on this class.

    Recorded test classes inherit from this base so they can reach the
    typed configuration via \`self.config\` and the diagnostic logger
    via \`self._logger\` without re-instantiating either one. Mirrors
    the role of the C# \`TestFixtureBase\` which exposes \`Config\`,
    \`Logger\`, and \`Faker\` on every test fixture.
    """

    # Hydrated from environment + .env once per process (see conftest.py).
    config = TestConfig
    # Default diagnostic logger — replace at the class level (or on a
    # specific test instance) to forward to a structured reporter.
    _logger: TestOutputLogger = TestOutputLogger()
    # Optional faker — None when the optional \`faker\` package isn't installed.
    faker: Optional[object] = Faker() if Faker is not None else None

    # Run-wide categorisation slots, kept in step with the C# fixture so
    # tests written against either language behave the same.
    test_category: str = ""
    fixture_test_category: str = ""
    test_suite_file_path: str = ""

    @classmethod
    def is_local_env(cls) -> bool:
        return AppConfiguration.is_local_env()
`;

export const PYTHON_BROWSER_MANAGER_CONTENT = `"""Owns the Playwright browser lifecycle helpers.

Mirrors the role of \`{{Namespace}}.Infrastructure.Services.BrowserManager\`
in the C# default architecture. The launching of browsers / contexts /
pages is delegated to \`pytest-playwright\` (which exposes the
\`browser\` / \`context\` / \`page\` fixtures already), so this class focuses
on the cross-cutting helpers C# users get from \`BrowserManager\`:

  * \`take_screenshot\` — writes a PNG into \`test-results/\` on failure.
  * \`start_tracing\` / \`stop_tracing\` — wraps Playwright's
    \`context.tracing.start()\` / \`stop()\` and (when configured) hands
    the resulting zip to \`PlaywrightTraceExtensions.upload_playwright_trace\`.
"""
from datetime import datetime
from pathlib import Path
from typing import Optional

from playwright.sync_api import BrowserContext, Page

from shared.playwright_trace_extensions import PlaywrightTraceExtensions
from shared.test_config import TestConfig
from shared.test_output_logger import TestOutputLogger

# Lexicographically sortable, locale-independent, Windows-safe (no
# colons or spaces). Matches the C# BrowserManager timestamp format so
# attachments interleave naturally when sorted by name.
TIMESTAMP_FORMAT = "%Y%m%d_%H%M%S"


def configure_page(page: Page) -> Page:
    """Apply suite-wide page defaults (timeouts, etc.)."""
    page.set_default_timeout(TestConfig.playwright_timeout)
    return page


class BrowserManager:
    """Wraps Playwright tracing and screenshot helpers."""

    def __init__(self) -> None:
        self.tracing_started: bool = False

    # -- Screenshots -------------------------------------------------------

    def take_screenshot(
        self,
        page: Page,
        logger: TestOutputLogger,
        test_name: str,
    ) -> Optional[str]:
        """Capture a full-page screenshot of \`page\` into \`test-results/\`.

        Returns the path it wrote, or \`None\` when Playwright threw — we
        intentionally swallow exceptions here so a screenshot failure
        never masks the underlying test failure.
        """
        try:
            out_dir = Path("test-results")
            out_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime(TIMESTAMP_FORMAT)
            target = out_dir / f"{test_name}_{stamp}.png"
            page.screenshot(path=str(target), full_page=True)
            logger.log_screenshot_data(str(target))
            return str(target)
        except Exception as ex:  # pragma: no cover - best-effort I/O
            logger.log_warning(f"Could not capture screenshot: {ex}")
            return None

    # -- Tracing -----------------------------------------------------------

    def start_tracing(self, context: BrowserContext, test_name: str = "") -> None:
        """Start a Playwright trace on \`context\`. Idempotent."""
        if self.tracing_started:
            return
        context.tracing.start(
            title=test_name,
            screenshots=True,
            snapshots=True,
            sources=True,
        )
        self.tracing_started = True

    def stop_tracing(
        self,
        context: BrowserContext,
        page: Optional[Page],
        upload: bool,
        logger: TestOutputLogger,
        test_name: str = "trace",
    ) -> Optional[str]:
        """Stop the trace started by \`start_tracing\`. Returns the zip path.

        Mirrors the C# \`StopTracingAsync\` contract: bail out cleanly
        when tracing was never started, or when the page is in the
        about:blank state (which usually means the test never navigated
        and the trace would be empty).
        """
        if not self.tracing_started:
            return None
        if page is not None and page.url == "about:blank":
            self.tracing_started = False
            return None
        try:
            traces_dir = Path("playwright-traces")
            traces_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime(TIMESTAMP_FORMAT)
            tracer_path = traces_dir / f"{test_name}_{stamp}.zip"
            context.tracing.stop(path=str(tracer_path))
            logger.log_tracer_data(str(tracer_path))
            if upload:
                try:
                    url = PlaywrightTraceExtensions.upload_playwright_trace(
                        str(tracer_path)
                    )
                    if url:
                        print(f"View Playwright trace: {url}")
                except Exception as ex:  # pragma: no cover - best-effort I/O
                    print(f"Trace upload failed: {ex}")
            return str(tracer_path)
        except Exception as ex:  # pragma: no cover - best-effort I/O
            logger.log_warning(f"Tracing could not be stopped: {ex}")
            return None
        finally:
            self.tracing_started = False
`;

export const PYTHON_TEST_CONFIG_CONTENT = `"""Strongly-typed mirror of the appsettings configuration.

Mirrors the role of \`{{Namespace}}.Shared.Configuration.TestConfig\` in
the C# default architecture: a single, discoverable surface that fixtures
and page objects can read configuration from without re-parsing
environment variables / \`.env\` on every test.

\`AppConfiguration.load_test_config\` (in \`shared/app_configuration.py\`)
hydrates these class-level attributes once per session, so consumers
read \`TestConfig.headless\` rather than \`os.environ.get("…", "false") == "true"\`.

Defaults are kept in sync with the C# \`appsettings.json\` so the class is
safe to import even when no environment variables are set.
"""
from typing import Dict


class TestConfig:
    """Class-level config surface — written to by AppConfiguration.load_test_config."""

    # ----- Mapped from environment / .env -----

    default_browser: str = "msedge"
    """Browser channel used when \`use_chromium\` is False."""

    headless: bool = False
    """Run the browser without a visible window."""

    use_chromium: bool = True
    """When True, launch vanilla Chromium; otherwise use \`default_browser\`."""

    start_tracer: bool = False
    """Force-enable Playwright tracing for every test in the run."""

    playwright_timeout: int = 30_000
    """Default Playwright operation timeout in milliseconds."""

    environment: str = "Local"
    """Active environment label (Local, Dev, QA, Prod, ...)."""

    urls: Dict[str, str] = {}
    """Named application URLs recorded into \`.env\`."""

    # ----- Run-wide switches set from CI / launcher / test code -----

    test_name: str = ""
    """When set, only the matching test method will run; others are skipped."""

    run_tracer: bool = False
    """Per-run override that toggles tracing without editing the config."""

    # ----- Named URLs (regenerated from .env on every recording) -----
    # The block below is rewritten by the recorder every time it upserts a
    # named URL or finalizes a recording, so each recorded suite can write
    # \`TestConfig.LOGIN\` instead of \`os.environ["ACMEPY_URL_LOGIN"]\`.
    # <auto-generated-urls>
    # </auto-generated-urls>
`;

export const PYTHON_CONSTANTS_CONTENT = `"""Compile-time string keys shared by infrastructure and tests.

Default values for run behavior (headless, use_chromium,
playwright_timeout, etc.) live on \`TestConfig\`, which is hydrated from
the environment / \`.env\` by \`AppConfiguration.load_test_config\`. Keep
this class limited to true compile-time identifiers (category names,
section keys) so we don't grow a second source of truth.

The recorder appends \`UPPER_SNAKE = "value"\` entries here when the user
records a \`fill\` action so generated test bodies read
\`Constants.user_name\` instead of an inline string literal. Mirrors
\`{{Namespace}}.Shared.Configuration.Constants\`.
"""


class Constants:
    """Marker class the recorder appends recorded constants onto."""

    START_TRACER = "start_tracer"
    """pytest marker name. Tag a test with \`@pytest.mark.start_tracer\`
    to force-enable Playwright tracing for just that test."""
`;

export const PYTHON_TEST_CONTEXT_HELPER_CONTENT = `"""Thin wrapper around the active pytest test item.

Mirrors the role of \`{{Namespace}}.Shared.Helpers.TestContextHelper\` in
the C# default architecture: exposes the most commonly used fields for
logging and conditional teardown logic so callers don't have to poke at
pytest internals directly.
"""
import pytest


class TestContextHelper:
    """Read-only view of the running pytest item's identity + outcome."""

    def __init__(self, item, report=None) -> None:
        self.item = item
        self.report = report

    @property
    def test_name(self) -> str:
        return self.item.name

    @property
    def class_name(self) -> str:
        cls = self.item.parent
        return getattr(cls, "name", "") if cls is not None else ""

    @property
    def method_name(self) -> str:
        return self.item.originalname or self.item.name

    @property
    def full_name(self) -> str:
        return self.item.nodeid

    @property
    def message(self) -> str:
        return getattr(self.report, "longreprtext", "") if self.report else ""

    @property
    def stack_trace(self) -> str:
        return getattr(self.report, "longreprtext", "") if self.report else ""

    def has_test_failed(self) -> bool:
        return bool(self.report and self.report.failed)

    def has_test_passed(self) -> bool:
        return bool(self.report and self.report.passed)

    def was_test_skipped(self) -> bool:
        return bool(self.report and self.report.skipped)

    def run_test_by_name(self, target_test_name: str) -> None:
        """Skip the running test when a name filter is set and doesn't match.

        Mirrors the C# \`RunTestByName\` helper used by \`TestConfig.test_name\`.
        """
        if not target_test_name:
            return
        if target_test_name.lower() != self.method_name.lower():
            pytest.skip(
                f"Skipped: filter '{target_test_name}' does not match {self.method_name}."
            )
`;

export const PYTHON_TEST_OUTPUT_LOGGER_CONTENT = `"""Diagnostic output helper.

Mirrors the role of \`{{Namespace}}.Shared.Helpers.TestOutputLogger\` in
the C# default architecture. Replace this implementation to forward to a
structured logger or test reporter without touching the fixture call
sites.
"""
from typing import Optional


class TestOutputLogger:
    """Pretty-printed test diagnostics. \`print\` so output streams to pytest."""

    def log_test_failed_data(self, context) -> None:
        print("==========================================")
        print(f"TEST FAILED: {context.full_name}")
        print(f"Message    : {context.message}")
        print(f"StackTrace : {context.stack_trace}")
        print("==========================================")

    def log_screenshot_data(self, screenshot_path: str) -> None:
        print(f"Screenshot saved to: {screenshot_path}")

    def log_tracer_data(self, tracer_path: str) -> None:
        print(f"Playwright trace saved to: {tracer_path}")
        print(f"View locally with: playwright show-trace {tracer_path}")

    def log_info(self, message: str) -> None:
        print(f"[INFO] {message}")

    def log_warning(self, message: str) -> None:
        print(f"[WARN] {message}")

    def log_error(self, message: str, ex: Optional[BaseException] = None) -> None:
        print(f"[ERROR] {message}")
        if ex is not None:
            print(repr(ex))
`;

export const PYTHON_TEST_TRACKER_CONTENT = `"""Process-wide counters for test outcomes.

Mirrors the role of \`{{Namespace}}.Shared.Helpers.TestTracker\` in the
C# default architecture. \`conftest.py\` calls these from
\`pytest_runtest_makereport\`, where each test has reported its outcome.
The resulting totals are useful when generating a run summary in an
end-of-run hook (e.g. \`pytest_sessionfinish\`).
"""


class TestTracker:
    """Atomic counters incremented from \`pytest_runtest_makereport\`."""

    _passing: int = 0
    _skipped: int = 0
    _failed: int = 0

    @classmethod
    def count_passing_tests(cls, peek: bool = False) -> int:
        if not peek:
            cls._passing += 1
        return cls._passing

    @classmethod
    def count_skipped_tests(cls, peek: bool = False) -> int:
        if not peek:
            cls._skipped += 1
        return cls._skipped

    @classmethod
    def count_failing_tests(cls, peek: bool = False) -> int:
        if not peek:
            cls._failed += 1
        return cls._failed

    @classmethod
    def reset(cls) -> None:
        cls._passing = 0
        cls._skipped = 0
        cls._failed = 0
`;

export const PYTHON_APP_CONFIGURATION_CONTENT = `"""Configuration loader shared by tests and infrastructure.

Mirrors the role of
\`{{Namespace}}.Shared.Configuration.AppConfigurationExtensions\` in the
C# default architecture: builds the configuration the same way no matter
where the test host is launched from, and resolves it onto the typed
\`TestConfig\` surface.

The Python implementation reads from environment variables and
optionally from a \`.env\` file in the project root via \`python-dotenv\`
(when installed). Missing entries leave the existing \`TestConfig\`
default in place so the call is safe to repeat.
"""
import os
from pathlib import Path
from typing import Mapping

from shared.test_config import TestConfig

try:  # pragma: no cover - optional dependency
    from dotenv import dotenv_values  # type: ignore
except Exception:  # pragma: no cover - dotenv is optional
    dotenv_values = None  # type: ignore[assignment]


class AppConfiguration:
    """Functional namespace mirroring \`AppConfigurationExtensions\` in C#."""

    @staticmethod
    def get_configuration(env_path: str = ".env") -> Mapping[str, str]:
        """Return a merged \`{key: value}\` view of \`.env\` + environment.

        Environment variables win on conflict, mirroring the C#
        \`ConfigurationBuilder.AddEnvironmentVariables\` ordering.
        """
        merged: dict[str, str] = {}
        if dotenv_values is not None and Path(env_path).is_file():
            for k, v in dotenv_values(env_path).items():
                if v is not None:
                    merged[k] = v
        merged.update({k: v for k, v in os.environ.items()})
        return merged

    @staticmethod
    def get_app_setting(configuration: Mapping[str, str], key: str) -> str:
        return configuration.get(key, "")

    @staticmethod
    def is_local_env(configuration: Mapping[str, str] | None = None) -> bool:
        env = (
            (configuration or {}).get("ENVIRONMENT")
            or os.environ.get("ENVIRONMENT")
            or TestConfig.environment
            or "Local"
        )
        return env.lower() in {"local", "development"}

    @staticmethod
    def load_test_config(configuration: Mapping[str, str]) -> Mapping[str, str]:
        """Hydrate \`TestConfig\` from \`configuration\`.

        Reads the same keys the C# \`LoadTestConfig\` reads from
        \`appsettings.json\`. Booleans accept any of \`true / 1 / yes\` (case
        insensitive). The \`Urls\` section is reconstructed from any
        \`<SOLUTION>_URL_<NAME>\` keys present in the configuration.
        """
        def _bool(key: str, fallback: bool) -> bool:
            raw = configuration.get(key)
            if raw is None:
                return fallback
            return raw.strip().lower() in {"true", "1", "yes"}

        TestConfig.default_browser = (
            configuration.get("DEFAULT_BROWSER") or TestConfig.default_browser
        )
        TestConfig.headless = _bool("HEADLESS", TestConfig.headless)
        TestConfig.use_chromium = _bool("USE_CHROMIUM", TestConfig.use_chromium)
        TestConfig.start_tracer = _bool("START_TRACER", TestConfig.start_tracer)
        try:
            TestConfig.playwright_timeout = int(
                configuration.get("PLAYWRIGHT_TIMEOUT")
                or TestConfig.playwright_timeout
            )
        except ValueError:
            pass
        TestConfig.environment = (
            configuration.get("ENVIRONMENT") or TestConfig.environment
        )

        urls: dict[str, str] = {}
        for k, v in configuration.items():
            # \`<SOLUTION>_URL_<NAME>\` → urls["<NAME>"] = v
            idx = k.find("_URL_")
            if idx > 0 and v:
                urls[k[idx + 5 :]] = v
        if urls:
            TestConfig.urls = urls
        # Mirror C# \`TestConfig.<Name>\`: hydrate the typed class attributes
        # the recorder regenerated into \`shared/test_config.py\` so tests
        # can read \`TestConfig.LOGIN\` without falling back to
        # \`TestConfig.urls["LOGIN"]\` or \`os.environ\` lookups.
        for name, value in urls.items():
            setattr(TestConfig, name, value)
        return configuration
`;

export const PYTHON_PLAYWRIGHT_TRACE_EXTENSIONS_CONTENT = `"""Hook for shipping a local Playwright trace zip to a remote viewer.

Replace \`PlaywrightTraceExtensions.upload_playwright_trace\` with your
own upload logic (S3, Azure Blob, GCS, ...) and return the public URL the
\`playwright show-trace\` viewer should be opened with.

Mirrors \`{{Namespace}}.Shared.Extensions.PlaywrightTraceExtensions\` in
the C# default architecture: a deliberately tiny seam for the
infrastructure layer to call out to without dragging the SDK into the
default scaffold.
"""
from typing import Optional


class PlaywrightTraceExtensions:
    @staticmethod
    def upload_playwright_trace(tracer_path: str) -> Optional[str]:
        """No-op default. Replace with real upload logic when ready."""
        _ = tracer_path
        return None
`;
