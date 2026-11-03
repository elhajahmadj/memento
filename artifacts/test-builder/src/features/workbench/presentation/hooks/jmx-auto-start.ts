/**
 * One-shot in-memory marker that the projects-home page sets right
 * after a freshly-created JMX project, and that
 * `<JmxRecordingControls />` consumes on mount to auto-start the
 * recording browser at the project's target URL.
 *
 * Module-level state (not sessionStorage) so that a page reload after
 * the create clears the marker — auto-start only fires for the
 * "just created" transition, not for subsequent visits to the
 * workbench.
 */
let pendingProjectId: string | null = null;

export function markJmxAutoStart(projectId: string): void {
  pendingProjectId = projectId;
}

export function consumeJmxAutoStart(projectId: string): boolean {
  if (pendingProjectId !== null && pendingProjectId === projectId) {
    pendingProjectId = null;
    return true;
  }
  return false;
}
