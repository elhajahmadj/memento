/**
 * Stable per-recording metadata that the per-language codegens read at
 * finalize time to decide whether to emit a skip/ignore decorator and a
 * Test Category attribute on the generated test method (and, for the
 * category case, whether to create / update the suite's
 * `TestCategories/{Suite}TestCategories` constants file).
 *
 * Kept in `domain/` and exported from a stable path so the four
 * per-language codegen tasks (C# / Python / Node.js / Java) can import
 * it without coordinating on the shape.
 *
 * Field semantics:
 *
 * - `ignoreReason`: when non-null, the codegen decorates the test
 *   method with the language-appropriate skip/ignore attribute and
 *   uses the string as the human-readable reason. `null` means the
 *   test runs normally (no decorator emitted).
 * - `categoryConstantName` + `categoryValue`: both-or-neither. When
 *   both are non-null/non-empty the codegen writes a
 *   `public const string {categoryConstantName} = "{categoryValue}"`
 *   into the per-suite constants file and decorates the test method
 *   with the language-appropriate Category/Trait/marker referencing
 *   that constant. Either both must be present or both must be null —
 *   the route handler rejects half-supplied pairs with HTTP 400, so
 *   downstream codegens can rely on the invariant.
 */
export interface RecordingMetadata {
  ignoreReason?: string | null | undefined;
  categoryConstantName?: string | null | undefined;
  categoryValue?: string | null | undefined;
}

/** Default empty metadata — every field null. */
export const EMPTY_RECORDING_METADATA: RecordingMetadata = {
  ignoreReason: null,
  categoryConstantName: null,
  categoryValue: null,
};
