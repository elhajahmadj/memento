/**
 * Back-compat shim for the historical `codegen.ts` entry point.
 *
 * The bulk of this module — the C#/NUnit emitter — now lives in
 * `csharpCodegen.ts`, alongside its sibling per-language emitters
 * (`pythonCodegen.ts`, `nodejsCodegen.ts`, `javaCodegen.ts`). New
 * callers should import the language-agnostic orchestrator from
 * `@/features/codegen/application/useCases/generateTest`, the
 * per-language adapter from `codegenAdapter.ts`, or — for the genuinely
 * C#-only helpers consumed by the recording service — directly from
 * `csharpCodegen.ts`.
 *
 * This shim is retained so the many ambient callers that still import
 * the `RecordedAction` type (and a handful of helpers) from
 * `@/features/codegen/infrastructure/codegen` keep compiling. A
 * follow-up task ("Split the C# codegen emitter into per-section
 * modules") will further break `csharpCodegen.ts` apart and is the
 * right place to migrate those callers off this shim.
 */
export * from "@/features/codegen/infrastructure/csharpCodegen";
