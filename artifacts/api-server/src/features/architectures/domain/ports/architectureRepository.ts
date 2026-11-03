/**
 * Persistence port for architectures. Use cases depend on this
 * interface; concrete adapters live under `infrastructure/repositories/`.
 *
 * The current production adapter persists each custom architecture as a
 * JSON file in the workspace's `.architectures/` directory. Tests can
 * substitute an in-memory implementation.
 */
import type { Architecture } from "../types";

export interface ArchitectureRepository {
  /** Return every custom (non-built-in) architecture. */
  list(): Promise<Architecture[]>;
  /** Return the custom architecture with the given id, or null. */
  findById(id: string): Promise<Architecture | null>;
  /** Persist the given architecture, returning the stored representation. */
  save(arch: Architecture): Promise<Architecture>;
  /** Delete the architecture with the given id, no-op if absent. */
  delete(id: string): Promise<void>;
}
