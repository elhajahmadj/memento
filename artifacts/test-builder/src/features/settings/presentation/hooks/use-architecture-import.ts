import { useState, useRef } from "react";
import { toast } from "sonner";
import type {
  Architecture,
  ArchProject,
} from "@workspace/api-client-react";
import {
  newId,
  newGuid,
  type ImportResult,
} from "@/features/settings/domain/architecture-helpers";

interface UseArchitectureImportOpts {
  architectures: Architecture[] | undefined;
  upsert: (a: Architecture) => Promise<Architecture>;
}

export function useArchitectureImport({
  architectures,
  upsert,
}: UseArchitectureImportOpts) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const retryInputRef = useRef<HTMLInputElement | null>(null);
  const [importResults, setImportResults] = useState<ImportResult[] | null>(
    null,
  );
  const [pendingImport, setPendingImport] = useState<Architecture | null>(null);
  const [importRenameMode, setImportRenameMode] = useState(false);
  const [importRenameValue, setImportRenameValue] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const [isDialogDragOver, setIsDialogDragOver] = useState(false);
  const dialogDragDepthRef = useRef(0);

  const findUniqueArchName = (base: string): string => {
    const taken = new Set(
      (architectures ?? []).map((a) => a.name.toLowerCase()),
    );
    if (!taken.has(base.toLowerCase())) return base;
    let n = 2;
    while (taken.has(`${base} (${n})`.toLowerCase())) n++;
    return `${base} (${n})`;
  };

  const performImport = async (arch: Architecture) => {
    const saved = await upsert(arch);
    toast.success(`Imported "${saved.name}"`);
    setPendingImport(null);
    setImportRenameMode(false);
    setImportRenameValue("");
  };

  const parseOneFile = async (
    file: File,
  ): Promise<
    { ok: true; imported: Architecture } | { ok: false; result: ImportResult }
  > => {
    try {
      const text = await file.text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return {
          ok: false,
          result: {
            fileName: file.name,
            status: "error",
            reason: "not valid JSON",
          },
        };
      }
      if (!raw || typeof raw !== "object") {
        return {
          ok: false,
          result: {
            fileName: file.name,
            status: "error",
            reason: "invalid architecture file",
          },
        };
      }
      const obj = raw as Partial<Architecture>;
      if (typeof obj.name !== "string" || !obj.name.trim()) {
        return {
          ok: false,
          result: {
            fileName: file.name,
            status: "error",
            reason: "missing a name",
          },
        };
      }
      if (!Array.isArray(obj.projects) || obj.projects.length === 0) {
        return {
          ok: false,
          result: {
            fileName: file.name,
            status: "error",
            reason: "must contain at least one project",
          },
        };
      }
      const imported: Architecture = {
        id: "",
        name: obj.name.trim(),
        isBuiltIn: false,
        projects: (obj.projects as ArchProject[]).map((p) => ({
          ...p,
          id: newId(),
          slnGuid: p.slnGuid || newGuid(),
        })),
      };
      return { ok: true, imported };
    } catch (err) {
      return {
        ok: false,
        result: {
          fileName: file.name,
          status: "error",
          reason: (err as Error).message ?? "failed to import",
        },
      };
    }
  };

  const importOneFile = async (file: File): Promise<ImportResult> => {
    const parsed = await parseOneFile(file);
    if (!parsed.ok) return parsed.result;
    const imported = parsed.imported;
    const lowerName = imported.name.toLowerCase();
    const list = architectures ?? [];
    if (
      list.some((a) => a.isBuiltIn && a.name.toLowerCase() === lowerName)
    ) {
      return {
        fileName: file.name,
        status: "error",
        reason: `"${imported.name}" is reserved by the built-in architecture`,
      };
    }
    if (
      list.some((a) => !a.isBuiltIn && a.name.toLowerCase() === lowerName)
    ) {
      return {
        fileName: file.name,
        status: "error",
        reason: `an architecture named "${imported.name}" already exists`,
      };
    }
    try {
      const saved = await upsert(imported);
      return {
        fileName: file.name,
        status: "success",
        architectureId: saved.id,
        architectureName: saved.name,
      };
    } catch (err) {
      return {
        fileName: file.name,
        status: "error",
        reason: (err as Error).message ?? "failed to import",
      };
    }
  };

  const importFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const results: ImportResult[] = [];
    const acceptedThisBatch = new Set<string>();

    for (const file of files) {
      const parsed = await parseOneFile(file);
      if (!parsed.ok) {
        results.push(parsed.result);
        continue;
      }
      const imported = parsed.imported;
      const lowerName = imported.name.toLowerCase();
      const list = architectures ?? [];
      if (
        list.some((a) => a.isBuiltIn && a.name.toLowerCase() === lowerName)
      ) {
        results.push({
          fileName: file.name,
          status: "error",
          reason: `"${imported.name}" is reserved by the built-in architecture`,
        });
        continue;
      }
      const customClash =
        list.some(
          (a) => !a.isBuiltIn && a.name.toLowerCase() === lowerName,
        ) || acceptedThisBatch.has(lowerName);
      if (customClash) {
        if (files.length === 1) {
          setPendingImport(imported);
          setImportRenameValue(findUniqueArchName(imported.name));
          setImportRenameMode(false);
          return;
        }
        results.push({
          fileName: file.name,
          status: "error",
          reason: `an architecture named "${imported.name}" already exists`,
        });
        continue;
      }
      try {
        const saved = await upsert(imported);
        acceptedThisBatch.add(lowerName);
        results.push({
          fileName: file.name,
          status: "success",
          architectureId: saved.id,
          architectureName: saved.name,
        });
      } catch (err) {
        results.push({
          fileName: file.name,
          status: "error",
          reason: (err as Error).message ?? "failed to import",
        });
      }
    }

    const successes = results.filter((r) => r.status === "success");
    const failures = results.filter((r) => r.status === "error");
    if (files.length === 1) {
      const r = results[0];
      if (r.status === "success") toast.success(`Imported "${r.architectureName}"`);
      else toast.error(`Failed to import ${r.fileName}: ${r.reason}`);
      return;
    }
    setImportResults(results);
    if (failures.length === 0) {
      toast.success(
        `Imported ${successes.length} of ${files.length} architectures`,
      );
    } else if (successes.length > 0) {
      toast.warning(
        `Imported ${successes.length} of ${files.length}. ${failures.length} failed.`,
      );
    } else {
      toast.error(`Failed to import ${failures.length} files`);
    }
  };

  const collectJsonFilesFromEntry = async (
    entry: FileSystemEntry,
  ): Promise<File[]> => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file = await new Promise<File | null>((resolve) => {
        fileEntry.file(
          (f) => resolve(f),
          () => resolve(null),
        );
      });
      if (!file) return [];
      const isJson =
        file.type === "application/json" ||
        file.name.toLowerCase().endsWith(".json");
      return isJson ? [file] : [];
    }
    if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const all: File[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve) => {
          reader.readEntries(
            (entries) => resolve(entries),
            () => resolve([]),
          );
        });
        if (batch.length === 0) break;
        for (const child of batch) {
          all.push(...(await collectJsonFilesFromEntry(child)));
        }
      }
      return all;
    }
    return [];
  };

  const collectJsonFilesFromDrop = async (
    e: React.DragEvent,
  ): Promise<File[]> => {
    const items = Array.from(e.dataTransfer.items ?? []);
    const collected: File[] = [];
    if (items.length > 0 && typeof items[0].webkitGetAsEntry === "function") {
      for (const item of items) {
        if (item.kind !== "file") continue;
        const entry = item.webkitGetAsEntry();
        if (entry) {
          collected.push(...(await collectJsonFilesFromEntry(entry)));
        } else {
          const file = item.getAsFile();
          if (file && file.name.toLowerCase().endsWith(".json")) {
            collected.push(file);
          }
        }
      }
    } else {
      for (const file of Array.from(e.dataTransfer.files ?? [])) {
        if (file.name.toLowerCase().endsWith(".json")) collected.push(file);
      }
    }
    return collected;
  };

  const retryFailedFiles = async (picked: File[]) => {
    if (picked.length === 0) return;
    const failingNames = new Set(
      (importResults ?? [])
        .filter((r) => r.status === "error")
        .map((r) => r.fileName),
    );
    if (failingNames.size === 0) return;

    const matched = picked.filter((f) => failingNames.has(f.name));
    const ignored = picked.length - matched.length;
    if (matched.length === 0) {
      toast.error(
        ignored === 1
          ? "That file's name doesn't match any failed import"
          : "None of the chosen files match a failed import name",
      );
      return;
    }
    const seen = new Set<string>();
    const retried: ImportResult[] = [];
    for (const file of matched) {
      if (seen.has(file.name)) continue;
      seen.add(file.name);
      retried.push(await importOneFile(file));
    }
    const retriedByName = new Map(retried.map((r) => [r.fileName, r]));
    setImportResults((prev) =>
      prev
        ? prev.map((r) =>
            r.status === "error" && retriedByName.has(r.fileName)
              ? retriedByName.get(r.fileName)!
              : r,
          )
        : prev,
    );
    const newSuccess = retried.filter((r) => r.status === "success").length;
    const stillFailed = retried.length - newSuccess;
    if (stillFailed === 0) {
      toast.success(
        newSuccess === 1
          ? "Retry succeeded"
          : `Retried ${newSuccess} files successfully`,
      );
    } else if (newSuccess > 0) {
      toast.warning(
        `Retried ${newSuccess} of ${retried.length}. ${stillFailed} still failed.`,
      );
    } else {
      toast.error(
        retried.length === 1
          ? "Retry still failed"
          : `Retry still failed for ${stillFailed} files`,
      );
    }
    if (ignored > 0) {
      toast.info(
        ignored === 1
          ? "1 chosen file didn't match a failed import name and was skipped"
          : `${ignored} chosen files didn't match a failed import name and were skipped`,
      );
    }
  };

  const handleDroppedJsonFiles = async (collected: File[]) => {
    if (collected.length === 0) {
      toast.error("No JSON files found in the dropped items");
      return;
    }
    const failingNames = new Set(
      (importResults ?? [])
        .filter((r) => r.status === "error")
        .map((r) => r.fileName),
    );
    if (failingNames.size > 0) {
      const matched = collected.filter((f) => failingNames.has(f.name));
      if (matched.length > 0) {
        await retryFailedFiles(collected);
        return;
      }
      toast.info(
        collected.length === 1
          ? "Dropped file's name doesn't match a failed import; skipped"
          : "None of the dropped files match a failed import name; skipped",
      );
      return;
    }
    await importFiles(collected);
  };

  const handleImportClick = () => fileInputRef.current?.click();
  const handleRetryFailedClick = () => retryInputRef.current?.click();

  const handleImportFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await importFiles(files);
  };

  const handleRetryFailedFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    await retryFailedFiles(picked);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  };
  const handleDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    const collected = await collectJsonFilesFromDrop(e);
    await handleDroppedJsonFiles(collected);
  };

  const handleDialogDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    dialogDragDepthRef.current += 1;
    setIsDialogDragOver(true);
  };
  const handleDialogDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };
  const handleDialogDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    dialogDragDepthRef.current = Math.max(0, dialogDragDepthRef.current - 1);
    if (dialogDragDepthRef.current === 0) setIsDialogDragOver(false);
  };
  const handleDialogDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    dialogDragDepthRef.current = 0;
    setIsDialogDragOver(false);
    const collected = await collectJsonFilesFromDrop(e);
    await handleDroppedJsonFiles(collected);
  };

  const handleImportKeepBoth = async () => {
    if (!pendingImport) return;
    const newName = findUniqueArchName(pendingImport.name);
    await performImport({ ...pendingImport, name: newName });
  };

  const handleImportConfirmRename = async () => {
    if (!pendingImport) return;
    const trimmed = importRenameValue.trim();
    if (!trimmed) {
      toast.error("Name is required");
      return;
    }
    const list = architectures ?? [];
    if (
      list.some(
        (a) => a.isBuiltIn && a.name.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      toast.error(`"${trimmed}" is reserved by the built-in architecture`);
      return;
    }
    if (
      list.some(
        (a) => !a.isBuiltIn && a.name.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      toast.error(`An architecture named "${trimmed}" already exists`);
      return;
    }
    await performImport({ ...pendingImport, name: trimmed });
  };

  const closeImportDialog = () => {
    setPendingImport(null);
    setImportRenameMode(false);
    setImportRenameValue("");
  };

  return {
    fileInputRef,
    retryInputRef,
    importResults,
    setImportResults,
    pendingImport,
    importRenameMode,
    setImportRenameMode,
    importRenameValue,
    setImportRenameValue,
    isDragOver,
    isDialogDragOver,
    handleImportClick,
    handleRetryFailedClick,
    handleImportFile,
    handleRetryFailedFile,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDialogDragEnter,
    handleDialogDragOver,
    handleDialogDragLeave,
    handleDialogDrop,
    handleImportKeepBoth,
    handleImportConfirmRename,
    closeImportDialog,
  };
}
