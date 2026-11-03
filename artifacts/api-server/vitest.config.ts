import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

// Mirror the esbuild `.txt` text loader (see build.mjs) so the codegen
// template imports resolve to file contents under vitest the same way
// they do at runtime. Without this, `import x from "./_foo.txt"` returns
// the import URL string instead of the template body, and any test that
// exercises the scaffolders silently produces files full of un-replaced
// `{{NAMESPACE}}` placeholders.
function txtAsText(): Plugin {
  return {
    name: "txt-as-text",
    enforce: "pre",
    async load(id) {
      const clean = id.split("?")[0];
      if (!clean.endsWith(".txt")) return null;
      const source = await fs.readFile(clean, "utf8");
      return `export default ${JSON.stringify(source)};`;
    },
  };
}

export default defineConfig({
  plugins: [txtAsText()],
  resolve: {
    alias: {
      "@": path.resolve(here, "src"),
    },
  },
  test: {
    globals: false,
    globalSetup: [path.resolve(here, "src/shared/test-helpers/globalSetup.ts")],
  },
});
