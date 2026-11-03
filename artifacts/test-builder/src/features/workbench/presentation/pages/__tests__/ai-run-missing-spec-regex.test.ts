import { describe, expect, it } from "vitest";

const MISSING_SPEC_RE = /Build with AI: cannot attach to ['"]([^'"]+)['"]/;

describe("ai-run-status missing-spec pattern", () => {
  const cases: Array<{ language: string; message: string; rel: string }> = [
    {
      language: "nodejs",
      message:
        "Build with AI: cannot attach to 'tests/login.spec.ts' — file not found. " +
        "Verify the file path, or switch to 'New test suite' to author a standalone suite.",
      rel: "tests/login.spec.ts",
    },
    {
      language: "csharp",
      message:
        "Build with AI: cannot attach to 'Tests/LoginPageTestSuite.cs' — the file is missing, unreadable, or contains no top-level C# class declaration. " +
        "Verify the file path, or switch to 'New test suite' to author a standalone suite.",
      rel: "Tests/LoginPageTestSuite.cs",
    },
    {
      language: "python",
      message:
        "Build with AI: cannot attach to 'tests/test_login.py' — file not found. " +
        "Verify the file path, or switch to 'New test suite' to author a standalone suite.",
      rel: "tests/test_login.py",
    },
    {
      language: "java-missing",
      message:
        "Build with AI: cannot attach to 'src/test/java/tests/LoginTest.java' — file is missing or unreadable. " +
        "Verify the file path, or switch to 'New test suite' to author a standalone suite.",
      rel: "src/test/java/tests/LoginTest.java",
    },
    {
      language: "java-no-class",
      message:
        "Build with AI: cannot attach to 'src/test/java/tests/LoginTest.java' — no top-level Java class or package declaration found. " +
        "Verify the file path, or switch to 'New test suite' to author a standalone suite.",
      rel: "src/test/java/tests/LoginTest.java",
    },
  ];

  for (const c of cases) {
    it(`matches the ${c.language} emitter's missing-spec error`, () => {
      const m = c.message.match(MISSING_SPEC_RE);
      expect(m).not.toBeNull();
      expect(m?.[1]).toBe(c.rel);
    });
  }

  it("does not match unrelated error messages", () => {
    expect("Something else went wrong".match(MISSING_SPEC_RE)).toBeNull();
  });
});
