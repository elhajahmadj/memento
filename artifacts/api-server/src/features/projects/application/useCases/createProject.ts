import {
  err,
  ok,
  type AppError,
  type Result,
  notFoundError,
  validationError,
} from "@workspace/kernel";
import {
  API_DEFAULT_ARCHITECTURE_ID,
} from "@/features/projects/infrastructure/apiCsharpScaffolder";
import { getApiTestScaffolder } from "@/features/projects/infrastructure/apiTestScaffolderRegistry";
import {
  createJmxScaffold,
  normalizeJmxTargetUrl,
} from "@/features/jmx/infrastructure/jmxScaffolder";
import {
  DEFAULT_ARCHITECTURE_ID,
  JAVA_DEFAULT_ARCHITECTURE_ID,
  NODEJS_DEFAULT_ARCHITECTURE_ID,
  PYTHON_DEFAULT_ARCHITECTURE_ID,
  architectureLanguage,
  architectureSolutionType,
  architecturesComposition,
  getDefaultArchitecture,
  isBuiltInApiArchitectureId,
  normalizeLanguage,
  type Language,
} from "@/features/architectures/infrastructure/architectureService";
import type { Architecture } from "@/features/architectures/domain/types";
import type { ProjectRepository } from "../../domain/ports/projectRepository";
import {
  normalizeSolutionType,
  type Project,
  type ProjectMarker,
  type SolutionType,
} from "../../domain/types";
import {
  validateNamespace,
  validateSolutionName,
} from "../../domain/validation";
import { scaffoldFromArchitecture } from "../../infrastructure/scaffolders";
import { setCurrentProject } from "../../infrastructure/repositories/currentProjectStore";

export interface CreateProjectInput {
  solutionName: string;
  testProjectName?: string | undefined;
  namespace: string;
  architectureId?: string | undefined;
  language?: Language | undefined;
  solutionType?: SolutionType | undefined;
  /** JMX-only: target HTTP origin to rewrite captured URLs against. */
  targetUrl?: string | undefined;
  /** JMX-only: enable the JWT-bearer auth flow in the emitted plan. */
  jwtAuth?: boolean | undefined;
  /**
   * JMX-only: mark the project as a BFF (Backend-for-Frontend) auth
   * project. Persisted on `.testbuilder.json` as `bff: true`.
   * Defaults to `false` when omitted.
   */
  bff?: boolean | undefined;
  /**
   * Who is creating the project. Used to cache the result as *that
   * user's* active project. Audit finding M-4: this used to call
   * `setCurrentProject(project)` with no user, which wrote into a
   * process-wide `__default__` bucket that other users' reads could
   * fall back to — a cross-user state leak. Optional only so the type
   * stays additive; when absent, no active-project caching happens at
   * all rather than writing to a shared slot.
   */
  ownerUserId?: string | undefined;
}

export type CreateProjectError = AppError;

/**
 * Application use case for project creation.
 *
 * Validates the slug, resolves the right scaffolder (per-language built-in
 * default, custom architecture, or built-in API), invokes it, stamps the
 * marker, and caches the result as the active project.
 *
 * Result errors:
 *  - `validation` — bad slug / namespace / arch mismatch
 *  - `not_found` — referenced architecture doesn't exist
 */
async function resolveArchitecture(
  id: string,
): Promise<Result<Architecture | null, AppError>> {
  const r = await architecturesComposition.get.execute(id);
  if (r.kind === "ok") return ok(r.value);
  if (r.error.kind === "not_found") return ok(null);
  return err(r.error);
}

export function makeCreateProject(deps: { repo: ProjectRepository }) {
  return async function execute(
    args: CreateProjectInput,
  ): Promise<Result<Project, CreateProjectError>> {
    const { solutionName, namespace } = args;
    const solutionType = normalizeSolutionType(args.solutionType);

    const slugErr = validateSolutionName(solutionName);
    if (slugErr) return err(slugErr);
    const nsErr = validateNamespace(namespace);
    if (nsErr) return err(nsErr);

    // JMX projects bypass the architecture lookup entirely — JMX has no
    // source-code tree, just an on-disk workspace folder plus the
    // marker file that persists `targetUrl` / `jwtAuth` / `jmxFiles`.
    if (args.language === "jmx") {
      // Accept bare hostnames (e.g. `www.google.com`) and normalize to
      // an `https://` absolute URL so downstream recording code keeps
      // working. UI form and direct API callers get the same behavior.
      const targetUrl = normalizeJmxTargetUrl(args.targetUrl ?? "");
      if (targetUrl === null) {
        return err(
          validationError(
            args.targetUrl == null || args.targetUrl.trim() === ""
              ? "targetUrl is required for JMX projects"
              : `targetUrl is not a valid absolute URL: ${args.targetUrl}`,
          ),
        );
      }
      const jwtAuth = args.jwtAuth === true;
      const bff = args.bff === true;
      const scaffolded = await createJmxScaffold(solutionName, namespace);
      const marker: ProjectMarker = {
        architectureId: "jmx-default",
        testProjectName: scaffolded.testProjectName,
        namespace,
        solutionName,
        language: "jmx",
        solutionType: "playwright",
        targetUrl,
        jwtAuth,
        bff,
        jmxFiles: [],
      };
      await deps.repo.writeMarker(scaffolded.rootPath, marker);
      const project: Project = {
        ...scaffolded,
        targetUrl,
        jwtAuth,
        bff,
        jmxFiles: [],
      };
      setCurrentProject(project, args.ownerUserId ?? null);
      return ok(project);
    }

    if (solutionType === "api") {
      const apiLanguage = normalizeLanguage(args.language);
      const explicitArchId = args.architectureId;

      if (explicitArchId && !isBuiltInApiArchitectureId(explicitArchId)) {
        const customR = await resolveArchitecture(explicitArchId);
        if (customR.kind === "err") return err(customR.error);
        const customArch = customR.value;
        if (!customArch) {
          return err({
            ...notFoundError("architecture", explicitArchId),
            message: `Architecture not found: ${explicitArchId}`,
          });
        }
        if (architectureSolutionType(customArch) !== "api") {
          return err(
            validationError("Selected architecture is not an API architecture"),
          );
        }
        if (architectureLanguage(customArch) !== apiLanguage) {
          return err(
            validationError(
              `Architecture language ${architectureLanguage(customArch)} does not match selected language ${apiLanguage}`,
            ),
          );
        }
        const scaffolded = await scaffoldFromArchitecture(
          customArch,
          solutionName,
          namespace,
        );
        const marker: ProjectMarker = {
          architectureId: customArch.id,
          testProjectName: scaffolded.testProjectName,
          namespace,
          solutionName,
          language: apiLanguage,
          solutionType: "api",
        };
        await deps.repo.writeMarker(scaffolded.rootPath, marker);
        const project: Project = { ...scaffolded, solutionType: "api" };
        setCurrentProject(project, args.ownerUserId ?? null);
        return ok(project);
      }

      const scaffolder = getApiTestScaffolder(apiLanguage);
      const result = await scaffolder.scaffold(solutionName, namespace);
      const markerArchId =
        explicitArchId && isBuiltInApiArchitectureId(explicitArchId)
          ? explicitArchId === "api-default"
            ? API_DEFAULT_ARCHITECTURE_ID
            : explicitArchId
          : API_DEFAULT_ARCHITECTURE_ID;
      const marker: ProjectMarker = {
        architectureId: markerArchId,
        testProjectName: result.testProjectName,
        namespace,
        solutionName,
        language: apiLanguage,
        solutionType: "api",
      };
      await deps.repo.writeMarker(result.rootPath, marker);
      const project: Project = {
        solutionName,
        testProjectName: result.testProjectName,
        namespace,
        rootPath: result.rootPath,
        slnPath: result.slnPath,
        language: apiLanguage,
        solutionType: "api",
      };
      setCurrentProject(project, args.ownerUserId ?? null);
      return ok(project);
    }

    const language = normalizeLanguage(args.language);
    const architectureId =
      args.architectureId ??
      (language === "python"
        ? PYTHON_DEFAULT_ARCHITECTURE_ID
        : language === "nodejs"
          ? NODEJS_DEFAULT_ARCHITECTURE_ID
          : language === "java"
            ? JAVA_DEFAULT_ARCHITECTURE_ID
            : DEFAULT_ARCHITECTURE_ID);

    let arch: Architecture | null;
    if (architectureId === DEFAULT_ARCHITECTURE_ID) {
      arch = getDefaultArchitecture();
    } else {
      const r = await resolveArchitecture(architectureId);
      if (r.kind === "err") return err(r.error);
      arch = r.value;
    }
    if (!arch) {
      return err({
        ...notFoundError("architecture", architectureId),
        message: `Architecture not found: ${architectureId}`,
      });
    }
    const project = await scaffoldFromArchitecture(
      arch,
      solutionName,
      namespace,
    );
    return ok(project);
  };
}
