import {
  recordAudit,
  type RecordAuditInput,
} from "@/features/audit/infrastructure/recordAudit";
import type { AuditRecorder } from "../application/ports";

export function createAuditRecorderAdapter(): AuditRecorder {
  return {
    record: (args) => recordAudit(args as RecordAuditInput),
  };
}
