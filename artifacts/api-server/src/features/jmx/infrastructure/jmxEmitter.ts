/**
 * JMX emitter orchestrator.
 *
 * Two-phase pipeline: `buildJmxTree` (events → IR) → `serializeJmxTree`
 * (IR → XML). The validator runs against the produced XML before
 * returning so callers cannot accidentally write a structurally
 * broken plan or leak credentials in dynamic mode.
 */
import type {
  JmxExportOptions,
  JmxHttpEvent,
} from "@/features/jmx/domain/types";
import { buildJmxTree } from "@/features/jmx/infrastructure/jmxIr";
import { serializeJmxTree } from "@/features/jmx/infrastructure/jmxSerializer";
import {
  validateJmxXml,
  type JmxValidationResult,
} from "@/features/jmx/infrastructure/jmxValidator";

export interface JmxEmitResult {
  xml: string;
  validation: JmxValidationResult;
  /** True when `embedCredentials=false` and validation passed without flagging leaks. */
  safeToShare: boolean;
}

export class JmxEmitError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
  ) {
    super(message);
    this.name = "JmxEmitError";
  }
}

/** Build, serialize, and validate a JMeter plan from captured events. */
export function emitJmxXml(
  events: JmxHttpEvent[],
  options: JmxExportOptions,
): JmxEmitResult {
  const tree = buildJmxTree(events, options);
  const xml = serializeJmxTree(tree);
  const validation = validateJmxXml(xml, events, options);
  return {
    xml,
    validation,
    safeToShare: !options.embedCredentials && validation.ok,
  };
}

/**
 * Convenience: emit and throw if validation fails. The recording
 * finalize path uses this so a bad plan never reaches the disk.
 */
export function emitJmxXmlOrThrow(
  events: JmxHttpEvent[],
  options: JmxExportOptions,
): JmxEmitResult {
  const out = emitJmxXml(events, options);
  if (!out.validation.ok) {
    throw new JmxEmitError(
      `JMX emit failed validation: ${out.validation.errors.join("; ")}`,
      out.validation.errors,
    );
  }
  return out;
}
