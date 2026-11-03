export type TestLanguage = "csharp" | "python" | "nodejs" | "java";
export type TestKind = "e2e" | "unit" | "api";

export interface TestTotals {
  e2e: number;
  unit: number;
  api: number;
  all: number;
}

export interface DiscoveredTestMethod {
  type: "method";
  id: string;
  name: string;
  kind: TestKind;
  language: TestLanguage;
}

export interface DiscoveredTestFile {
  type: "file";
  name: string;
  path: string;
  language: TestLanguage;
  totals: TestTotals;
  methods: DiscoveredTestMethod[];
}

export interface DiscoveredTestFolder {
  type: "folder";
  name: string;
  path: string;
  totals: TestTotals;
  children: DiscoveredTestNode[];
}

export type DiscoveredTestNode = DiscoveredTestFolder | DiscoveredTestFile;

export interface TestDiscoveryResponse {
  projectName: string;
  slnPath: string;
  root: DiscoveredTestFolder;
}

/**
 * Raw method record returned by per-language parsers, before
 * classification. Tags listed here come from method-level
 * attributes/markers (e.g. `[Category("E2E")]`, `@pytest.mark.api`,
 * `@Tag("e2e")`). Class-level tags are merged in by the parser before
 * the record is handed to the classifier.
 */
export interface ParsedMethod {
  id: string;
  name: string;
  tags: string[];
}

export interface ParsedFile {
  /** Project-relative POSIX path. */
  path: string;
  language: TestLanguage;
  methods: ParsedMethod[];
  isFixture?: boolean | undefined;
}
