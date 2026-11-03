import { describe, expect, it } from "vitest";
import { vscodeFileUrl } from "../workbench";

describe("vscodeFileUrl", () => {
  it("builds a vscode://file URL for a unix absolute path", () => {
    expect(vscodeFileUrl("/home/alice/projects/MyApp")).toBe(
      "vscode://file/home/alice/projects/MyApp",
    );
  });

  it("normalises Windows backslashes and prepends a leading slash", () => {
    expect(vscodeFileUrl("C:\\Users\\alice\\projects\\MyApp")).toBe(
      "vscode://file/C:/Users/alice/projects/MyApp",
    );
  });

  it("preserves an existing leading slash without doubling it", () => {
    expect(vscodeFileUrl("/tmp/foo")).toBe("vscode://file/tmp/foo");
  });
});
