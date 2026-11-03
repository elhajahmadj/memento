/**
 * Layer enforcement for the api-server Clean Architecture refactor.
 *
 * The rule scope is the migrated `src/features/<feature>/{domain,
 * application,infrastructure,presentation}` slices, MINUS the
 * partially-migrated features listed in `IN_PROGRESS_FEATURES` below
 * for the layer rules. Those features still have application/domain
 * modules that reach into sibling infrastructure (their own or another
 * feature's) — cleaning them up is tracked as separate per-feature
 * refactors. Excluding them here keeps the lint signal trustworthy
 * (0 violations on a clean checkout) while still failing loudly when
 * any clean or future feature regresses.
 *
 * To re-enable enforcement on one of the in-progress features, remove
 * it from `IN_PROGRESS_FEATURES` and fix the resulting violations.
 *
 * The `no-circular` rule is broader than the layer rules: task #73
 * cleaned up every remaining cycle across `src/features/`, so it now
 * applies to the whole tree (no in-progress exclusion).
 *
 * Rules:
 *   - `domain` may not import from `application`, `infrastructure`, or
 *     `presentation`, nor from anything outside `@workspace/kernel`.
 *   - `application` may not import from `infrastructure` or
 *     `presentation`. It may import from `domain` and from
 *     `@workspace/kernel`.
 *   - No circular imports anywhere in `src/features/`.
 *
 * Run with: `pnpm --filter @workspace/api-server run lint:layers`.
 */

// Features whose application/domain layers still reach into
// infrastructure. Each one is a follow-up cleanup task; once a feature
// here is clean, remove it from this list so future regressions fail
// the build.
const IN_PROGRESS_FEATURES = [
  "codegen",
  "projects",
  "validation",
];

const inProgressGroup = `(?:${IN_PROGRESS_FEATURES.join("|")})`;
const enforcedFeaturePrefix = `^src/features/(?!${inProgressGroup}/)[^/]+/`;

module.exports = {
  forbidden: [
    {
      name: "domain-no-outward-imports",
      comment:
        "Domain modules must be pure: no imports from application, infrastructure, presentation, or any other workspace feature.",
      severity: "error",
      from: { path: `${enforcedFeaturePrefix}domain/` },
      to: {
        pathNot: [
          "^src/features/[^/]+/domain/",
          "^node_modules/@workspace/kernel/",
          // Static `.txt` template resources are pure data, not code
          // dependencies — the C# default architecture and the codegen
          // scaffolders both read from the same template files.
          "\\.txt$",
        ],
      },
    },
    {
      name: "application-no-infra-or-presentation",
      comment:
        "Application use cases may depend on domain + kernel only. They must not reach into infrastructure or presentation.",
      severity: "error",
      from: { path: `${enforcedFeaturePrefix}application/` },
      to: {
        path: [
          "^src/features/[^/]+/infrastructure/",
          "^src/features/[^/]+/presentation/",
        ],
      },
    },
    {
      name: "no-circular",
      comment:
        "Circular dependencies make modules hard to reason about. Scoped to all of `src/features/` so cycles within or across any feature fail the build.",
      severity: "error",
      from: { path: "^src/features/" },
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules"] },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["module", "main"],
    },
    includeOnly: "^src/",
  },
};
