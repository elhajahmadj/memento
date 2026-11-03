import { Router, type IRouter } from "express";
import {
  CreateFileBody,
  CreateFolderBody,
  DeleteFileQueryParams,
  GetFileContentQueryParams,
  GetFileContentResponse,
  RenameFileBody,
  UpdateFileBody,
} from "@workspace/api-zod";
import {
  createFile,
  createFolder,
  deleteFile,
  getCurrentProject,
  readFile,
  rename,
  writeFile,
} from "@/features/projects/infrastructure/projectService";
import {
  requireAdminOrAssignedToCurrentProject,
  requireAdminOrAssignedToCurrentProjectOrOwner,
} from "@/shared/middlewares/requireRole";
import { recordAudit } from "@/features/audit/infrastructure/recordAudit";
import { respondValidationError } from "@/shared/validationError";

const router: IRouter = Router();

function requireProject(
  req: Parameters<Parameters<IRouter["get"]>[1]>[0],
  res: Parameters<Parameters<IRouter["get"]>[1]>[1],
) {
  const project = getCurrentProject(req.user?.id);
  if (!project) {
    res.status(404).json({ error: "No project loaded" });
    return null;
  }
  return project;
}

router.get("/files", requireAdminOrAssignedToCurrentProjectOrOwner, async (req, res): Promise<void> => {
  const project = requireProject(req, res);
  if (!project) return;
  const parsed = GetFileContentQueryParams.safeParse(req.query);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  try {
    const content = await readFile(project, parsed.data.path);
    res.json(
      GetFileContentResponse.parse({ path: parsed.data.path, content }),
    );
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

router.post("/files", requireAdminOrAssignedToCurrentProject, async (req, res): Promise<void> => {
  const project = requireProject(req, res);
  if (!project) return;
  const parsed = CreateFileBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  try {
    await createFile(project, parsed.data.path, parsed.data.content ?? "");
    if (req.user) {
      await recordAudit({
        user: req.user,
        project: project.solutionName,
        action: "file_create",
        file: parsed.data.path,
        details: { bytes: (parsed.data.content ?? "").length },
      });
    }
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, message: (e as Error).message });
  }
});

router.put("/files", requireAdminOrAssignedToCurrentProject, async (req, res): Promise<void> => {
  const project = requireProject(req, res);
  if (!project) return;
  const parsed = UpdateFileBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  try {
    await writeFile(project, parsed.data.path, parsed.data.content);
    if (req.user) {
      await recordAudit({
        user: req.user,
        project: project.solutionName,
        action: "file_save",
        file: parsed.data.path,
        details: { bytes: parsed.data.content.length },
      });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, message: (e as Error).message });
  }
});

router.delete("/files", requireAdminOrAssignedToCurrentProject, async (req, res): Promise<void> => {
  const project = requireProject(req, res);
  if (!project) return;
  const parsed = DeleteFileQueryParams.safeParse(req.query);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  try {
    await deleteFile(project, parsed.data.path);
    if (req.user) {
      await recordAudit({
        user: req.user,
        project: project.solutionName,
        action: "file_delete",
        file: parsed.data.path,
      });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, message: (e as Error).message });
  }
});

router.post("/files/rename", requireAdminOrAssignedToCurrentProject, async (req, res): Promise<void> => {
  const project = requireProject(req, res);
  if (!project) return;
  const parsed = RenameFileBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  try {
    await rename(project, parsed.data.oldPath, parsed.data.newPath);
    if (req.user) {
      await recordAudit({
        user: req.user,
        project: project.solutionName,
        action: "file_rename",
        file: parsed.data.newPath,
        details: { from: parsed.data.oldPath, to: parsed.data.newPath },
      });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, message: (e as Error).message });
  }
});

router.post("/folders", requireAdminOrAssignedToCurrentProject, async (req, res): Promise<void> => {
  const project = requireProject(req, res);
  if (!project) return;
  const parsed = CreateFolderBody.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  try {
    await createFolder(project, parsed.data.path);
    if (req.user) {
      await recordAudit({
        user: req.user,
        project: project.solutionName,
        action: "folder_create",
        file: parsed.data.path,
      });
    }
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, message: (e as Error).message });
  }
});

export default router;
