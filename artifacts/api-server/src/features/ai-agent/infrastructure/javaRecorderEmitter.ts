// Thin re-export barrel. Implementation has moved into per-section
// modules under `./java/` (task #39). Existing imports continue to
// work without modification.
export { emitJava } from "./java/emitter";
export type { JavaEmitOptions } from "./java/types";
