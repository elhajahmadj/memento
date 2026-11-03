/**
 * Layer enforcement for the test-builder Clean Architecture refactor.
 *
 * Today this only enforces the rule on features that have already been
 * migrated into `src/features/<feature>/{domain,application,
 * infrastructure,presentation}`. As more features migrate, the
 * `applyTo` allowlist or the rule's scope can broaden.
 *
 * Rules:
 *   - `domain` may not import from `application`, `infrastructure`, or
 *     `presentation`, nor from React, the api-client, or any other
 *     framework.
 *   - `application` may not import from `infrastructure` or
 *     `presentation`. It may import from `domain` and from
 *     `@workspace/kernel`.
 *
 * Run with: `pnpm --filter @workspace/test-builder run lint:layers`.
 */
module.exports = {
  forbidden: [
    {
      name: "domain-no-outward-imports",
      comment:
        "Domain modules must be pure: no imports from application, infrastructure, presentation, React, or the api-client.",
      severity: "error",
      from: { path: "^src/features/[^/]+/domain/" },
      to: {
        pathNot: [
          "^src/features/[^/]+/domain/",
          "^node_modules/@workspace/kernel/",
        ],
      },
    },
    {
      name: "application-no-infra-or-presentation",
      comment:
        "Application use cases may depend on domain + kernel only. They must not reach into infrastructure or presentation.",
      severity: "error",
      from: { path: "^src/features/[^/]+/application/" },
      to: {
        path: [
          "^src/features/[^/]+/infrastructure/",
          "^src/features/[^/]+/presentation/",
          "^src/pages/",
          "^src/components/",
        ],
      },
    },
    {
      name: "no-circular",
      comment: "Circular dependencies make modules hard to reason about.",
      severity: "error",
      from: {},
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
