import { Router, type IRouter } from "express";
import { FinalizeRecordingResponse } from "@workspace/api-zod";
import { assertResponseShape } from "@/shared/assertResponseShape";
import {
  finalize,
  type StopDecision,
  SessionOwnershipError,
} from "@/features/recording/infrastructure/recordingService";
import { getCurrentProject } from "@/features/projects/infrastructure/projectService";
import { requireAdminOrAssignedToCurrentProjectOrOwnerAllowNoProject } from "@/shared/middlewares/requireRole";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import {
  getForkForUser,
  type ForkRow,
} from "@/features/forks/infrastructure/forkService";
import {
  createSubmissionFromFork,
  hasPendingSubmissionForFork,
} from "@/features/approvals/infrastructure/approvalService";

export function finalizeRoutes(): IRouter {
  const router = Router();

  router.post(
    "/recording/finalize",
    requireAdminOrAssignedToCurrentProjectOrOwnerAllowNoProject,
    async (req, res): Promise<void> => {
      let decision: StopDecision | undefined;
      const body = (req.body ?? {}) as { decision?: unknown; mode?: unknown };
      // Resolve the finalize mode. Default to "save" so existing admin clients
      // (which never sent a mode) keep working unchanged.
      const rawMode = body.mode;
      let mode: "save" | "submit-for-approval" = "save";
      if (rawMode !== undefined && rawMode !== null) {
        if (rawMode === "save" || rawMode === "submit-for-approval") {
          mode = rawMode;
        } else {
          res.status(400).json({
            status: "error",
            message: "mode must be 'save' or 'submit-for-approval'",
          });
          return;
        }
      }
      // Role gate: limited users may only use submit-for-approval; admins use
      // save (their changes go straight to main as before).
      const user = req.user;
      if (mode === "save" && user && user.role === "limited") {
        res.status(403).json({
          status: "error",
          message:
            "Limited users must finalize recordings via 'submit-for-approval'",
        });
        return;
      }
      if (
        mode === "submit-for-approval" &&
        user &&
        (user.role === "admin" || user.role === "limited_admin")
      ) {
        res.status(400).json({
          status: "error",
          message: "Admins finalize recordings directly; use mode 'save'",
        });
        return;
      }
      // Guests save directly, like admins. A guest trial is solo and
      // disposable: there is no SDET to review it, and guests own no
      // fork, so the approval path below would fail with the misleading
      // "you do not have an active fork" instead of explaining why.
      // Note `mode === "save"` is already allowed for them — the gate
      // above only rejects `limited`.
      if (mode === "submit-for-approval" && user && user.role === "guest") {
        res.status(400).json({
          status: "error",
          message:
            "Guest sessions save recordings directly; use mode 'save'",
        });
        return;
      }
      // Project + fork lookup happens before stop() so we can fail fast on a
      // duplicate pending submission instead of writing files for a request we'll
      // ultimately reject.
      let fork: ForkRow | null = null;
      if (mode === "submit-for-approval") {
        if (!user) {
          res.status(401).json({ status: "error", message: "Unauthorized" });
          return;
        }
        const project = getCurrentProject(user.id);
        if (!project) {
          res.status(400).json({
            status: "error",
            message: "No project loaded for this session",
          });
          return;
        }
        fork = await getForkForUser(user.id, project.solutionName);
        if (!fork || fork.status !== "active") {
          res.status(400).json({
            status: "error",
            message: "You do not have an active fork for this project",
          });
          return;
        }
        if (await hasPendingSubmissionForFork(fork.id)) {
          res.status(409).json({
            status: "error",
            message:
              "An approval submission is already pending for this fork. Wait for the SDET to decide before submitting again.",
          });
          return;
        }
      }
      if (body.decision !== undefined && body.decision !== null) {
        const raw = body.decision as { mode?: unknown; methodName?: unknown };
        if (raw.mode === "overwrite") {
          decision = { mode: "overwrite" };
        } else if (raw.mode === "rename") {
          const name =
            typeof raw.methodName === "string" ? raw.methodName.trim() : "";
          if (!name) {
            res.status(400).json({
              status: "error",
              message: "decision.methodName is required when mode is 'rename'",
            });
            return;
          }
          decision = { mode: "rename", methodName: name };
        } else {
          res
            .status(400)
            .json({ status: "error", message: "decision.mode must be 'overwrite' or 'rename'" });
          return;
        }
      }
      if (!req.user?.id) {
        res.status(401).json({ status: "error", message: "Unauthorized" });
        return;
      }
      try {
        // H-8: scoped to the caller. finalize writes the recorded actions
        // into project files, so a non-owner reaching it would commit
        // someone else's recording under their own name.
        const result = await finalize(decision, req.user.id);
        let submissionId: string | null = null;
        let submissionStatus: "pending" | "approved" | "rejected" | null = null;
        if (result.status === "completed" && req.user) {
          const project = getCurrentProject(req.user?.id);
          const projectName = project?.solutionName ?? null;
          // One audit row per file the recording touched, so the timeline shows
          // every file that changed during the finalize.
          for (const f of result.generatedFiles) {
            await recordAudit({
              user: req.user,
              project: projectName,
              action: "recording_finalize",
              file: f.path,
              details: { created: f.created, summary: result.summary },
            });
          }
          // Also record a no-file roll-up event when nothing was generated so the
          // finalize itself remains visible in the audit trail.
          if (result.generatedFiles.length === 0) {
            await recordAudit({
              user: req.user,
              project: projectName,
              action: "recording_finalize",
              details: { summary: result.summary },
            });
          }
          // submit-for-approval: snapshot the finalized fork into a pending
          // submission. We only reach here when stop() succeeded and the
          // pre-flight fork lookup passed, so the snapshot reflects what the
          // SDET will review.
          if (mode === "submit-for-approval" && fork) {
            try {
              const submission = await createSubmissionFromFork({
                fork,
                submittedBy: req.user.id,
              });
              submissionId = submission.id;
              submissionStatus = submission.status;
              await recordAudit({
                user: req.user,
                project: projectName,
                action: "approval_submit",
                details: {
                  submissionId: submission.id,
                  forkId: fork.id,
                  generatedFiles: result.generatedFiles.length,
                  summary: result.summary,
                },
              });
            } catch (err) {
              // Race-condition fallback: another request created a pending
              // submission for this fork between our pre-flight check and the
              // insert. The DB-level partial unique index
              // (UQ_approval_submissions_pending_per_fork) raises a
              // unique_violation (Postgres SQLSTATE 23505).
              const code = (err as { code?: string }).code;
              if (code === "23505") {
                res.status(409).json({
                  status: "error",
                  generatedFiles: result.generatedFiles,
                  summary: result.summary,
                  message:
                    "An approval is already pending for this fork. Wait for the SDET decision before submitting again.",
                });
                return;
              }
              throw err;
            }
          }
        }
        res.json(
          assertResponseShape(
            FinalizeRecordingResponse,
            { ...result, submissionId, submissionStatus },
            "POST /recording/finalize",
          ),
        );
      } catch (e) {
        if (e instanceof SessionOwnershipError) {
          res.status(403).json({
            status: "error",
            generatedFiles: [],
            summary: e.message,
          });
          return;
        }
        res
          .status(400)
          .json({ status: "error", generatedFiles: [], summary: (e as Error).message });
      }
    },
  );

  return router;
}
