import { useState } from "react";
import type { TreeNodeT } from "@/features/workbench/domain/types";

/**
 * Central state container for the workbench page's dialog stack. Each
 * dialog gets a flag (for boolean open/close dialogs) or a target value
 * (for dialogs keyed by a node / file path). Keeping this in one hook
 * lets the page shell stay thin and gives tests a single seam.
 */
export function useWorkbenchDialogs() {
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [buildTestOpen, setBuildTestOpen] = useState(false);
  const [addClassOpen, setAddClassOpen] = useState(false);
  const [addMethodFor, setAddMethodFor] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<TreeNodeT | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TreeNodeT | null>(null);
  const [addFolderUnder, setAddFolderUnder] = useState<string | null>(null);
  const [addFileUnder, setAddFileUnder] = useState<string | null>(null);
  const [validateOpen, setValidateOpen] = useState(false);
  const [aiAuthorMode, setAiAuthorMode] = useState<"step" | "assertion" | null>(
    null,
  );

  return {
    startDialogOpen,
    setStartDialogOpen,
    attachDialogOpen,
    setAttachDialogOpen,
    buildTestOpen,
    setBuildTestOpen,
    addClassOpen,
    setAddClassOpen,
    addMethodFor,
    setAddMethodFor,
    renameTarget,
    setRenameTarget,
    deleteTarget,
    setDeleteTarget,
    addFolderUnder,
    setAddFolderUnder,
    addFileUnder,
    setAddFileUnder,
    validateOpen,
    setValidateOpen,
    aiAuthorMode,
    setAiAuthorMode,
  };
}

export type WorkbenchDialogState = ReturnType<typeof useWorkbenchDialogs>;
