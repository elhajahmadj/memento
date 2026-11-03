/**
 * Python (playwright-python + pytest) sister module of `codegen.ts`.
 *
 * Implementation moved into per-section modules under
 * `./languages/python/` (task #37). This file is preserved as a barrel
 * re-export so the ~10 existing import sites (codegenAdapter, recording
 * service, multilang test, the per-section test files, and the AI Agent
 * Python emitter) keep working without a sweeping import rewrite. New
 * code should import from `./languages/python` directly.
 *
 * Generated layout (Python):
 *   tests/test_<snake>.py                       (one per recorded test class)
 *   pages/selectors/<snake>_selectors.py
 *   pages/actions/<snake>_actions.py
 *   constants/<snake_suite>_constants.py        (recorded fill values, per suite)
 *   test_categories/<snake_suite>_categories.py (Test Categories — upserted on demand)
 */
export * from "./languages/python";
