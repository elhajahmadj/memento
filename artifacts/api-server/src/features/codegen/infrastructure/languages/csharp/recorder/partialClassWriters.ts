import { safeJoin } from "@/features/projects/infrastructure/paths";
import { escapeCs } from "./identifiers";
import { exists, HEADER, writeFileSafe } from "./appsettingsIO";
import type { PageMethodSpec } from "./pageMethods";

// ---------------------------------------------------------------------
// File writers — partial-class sidecar pattern
// ---------------------------------------------------------------------

export interface SelectorsArgs {
  projectRoot: string;
  baseRel: string;
  partialRel: string;
  ns: string;
  suiteStem: string;
  selectors: Map<string, string>;
  runId: string;
}

/**
 * If the canonical `{Stem}PageSelectors.cs` file doesn't exist, write
 * it from scratch (safe, no user code to preserve). If it does exist,
 * write a `*.AiGenerated.cs` partial-class sibling containing only
 * the AI-added selectors — leaving the original file untouched.
 */
export async function writeSelectorsArtifact(args: SelectorsArgs): Promise<string> {
  const baseAbs = safeJoin(args.projectRoot, args.baseRel);
  const className = `${args.suiteStem}PageSelectors`;
  const lines = Array.from(args.selectors.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([k, v]) =>
        `        public static readonly string ${k} = "${escapeCs(v)}";`,
    );
  if (await exists(baseAbs)) {
    // Partial sidecar — same class, additive members only.
    const content = `${HEADER(args.runId)}
namespace ${args.ns}.Tests.PageObjects.Selectors
{
    public static partial class ${className}
    {
${lines.join("\n")}
    }
}
`;
    await writeFileSafe(args.projectRoot, args.partialRel, content);
    return args.partialRel;
  }
  const content = `namespace ${args.ns}.Tests.PageObjects.Selectors
{
    public static partial class ${className}
    {
${lines.join("\n")}
    }
}
`;
  await writeFileSafe(args.projectRoot, args.baseRel, content);
  return args.baseRel;
}

export interface InterfaceArgs {
  projectRoot: string;
  baseRel: string;
  partialRel: string;
  ns: string;
  interfaceName: string;
  methods: PageMethodSpec[];
  runId: string;
}

export async function writeInterfaceArtifact(args: InterfaceArgs): Promise<string> {
  const baseAbs = safeJoin(args.projectRoot, args.baseRel);
  // Dedupe by signature.
  const seen = new Set<string>();
  const sigLines: string[] = [];
  for (const m of args.methods) {
    if (seen.has(m.signature)) continue;
    seen.add(m.signature);
    sigLines.push(`        Task ${m.signature};`);
  }
  if (await exists(baseAbs)) {
    // C# allows partial interfaces. Emit a sidecar with additive
    // method declarations so the canonical interface stays untouched.
    const content = `${HEADER(args.runId)}
using System.Threading.Tasks;

namespace ${args.ns}.Tests.PageObjects.Interfaces
{
    public partial interface ${args.interfaceName}
    {
${sigLines.join("\n")}
    }
}
`;
    await writeFileSafe(args.projectRoot, args.partialRel, content);
    return args.partialRel;
  }
  const content = `using System.Threading.Tasks;

namespace ${args.ns}.Tests.PageObjects.Interfaces
{
    public partial interface ${args.interfaceName}
    {
${sigLines.join("\n")}
    }
}
`;
  await writeFileSafe(args.projectRoot, args.baseRel, content);
  return args.baseRel;
}

export interface PageObjectArgs {
  projectRoot: string;
  baseRel: string;
  partialRel: string;
  ns: string;
  pageName: string;
  interfaceName: string;
  methods: PageMethodSpec[];
  suiteStem: string;
  runId: string;
}

export async function writePageObjectArtifact(args: PageObjectArgs): Promise<string> {
  const baseAbs = safeJoin(args.projectRoot, args.baseRel);
  const seen = new Set<string>();
  const methodBlocks: string[] = [];
  for (const m of args.methods) {
    if (seen.has(m.signature)) continue;
    seen.add(m.signature);
    methodBlocks.push(
      `        public async Task ${m.signature}\n        {\n            ${m.body}\n        }`,
    );
  }
  if (await exists(baseAbs)) {
    // Partial sidecar — the existing `partial class {Page}` (or, if
    // the developer forgot the `partial` keyword, a compile error
    // which they'll see immediately) hosts the constructor + IPage
    // field. We only add new methods; the field is already in scope.
    const content = `${HEADER(args.runId)}
using System.Threading.Tasks;
using Microsoft.Playwright;
using ${args.ns}.Tests.PageObjects.Selectors;

namespace ${args.ns}.Tests.PageObjects.Actions
{
    public partial class ${args.pageName}
    {
${methodBlocks.join("\n\n")}
    }
}
`;
    await writeFileSafe(args.projectRoot, args.partialRel, content);
    return args.partialRel;
  }
  const content = `using System.Threading.Tasks;
using Microsoft.Playwright;
using ${args.ns}.Tests.PageObjects.Interfaces;
using ${args.ns}.Tests.PageObjects.Selectors;

namespace ${args.ns}.Tests.PageObjects.Actions
{
    public partial class ${args.pageName} : ${args.interfaceName}
    {
        private readonly IPage _page;

        public ${args.pageName}(IPage page)
        {
            _page = page;
        }

${methodBlocks.join("\n\n")}
    }
}
`;
  await writeFileSafe(args.projectRoot, args.baseRel, content);
  return args.baseRel;
}

export interface ConstantsArgs {
  projectRoot: string;
  baseRel: string;
  partialRel: string;
  ns: string;
  className: string;
  consts: Map<string, string>;
  runId: string;
}

export async function writeConstantsArtifact(args: ConstantsArgs): Promise<string> {
  const baseAbs = safeJoin(args.projectRoot, args.baseRel);
  const lines = Array.from(args.consts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([k, v]) => `        public const string ${k} = "${escapeCs(v)}";`,
    );
  if (await exists(baseAbs)) {
    const content = `${HEADER(args.runId)}
namespace ${args.ns}.Tests.Constants
{
    public static partial class ${args.className}
    {
${lines.join("\n")}
    }
}
`;
    await writeFileSafe(args.projectRoot, args.partialRel, content);
    return args.partialRel;
  }
  const content = `namespace ${args.ns}.Tests.Constants
{
    public static partial class ${args.className}
    {
${lines.join("\n")}
    }
}
`;
  await writeFileSafe(args.projectRoot, args.baseRel, content);
  return args.baseRel;
}
