/**
 * Public surface of the codegen feature. Sibling features and the
 * composition root import from here only — never reach into deeper
 * paths. Internal modules (`./domain/...`, `./application/...`) are
 * implementation details.
 */
export * from "./domain/valueObjects";
export * from "./application/useCases/normalizeNoun";
