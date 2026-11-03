export function RecordingTargetLabel({
  target,
  targetClass,
  methodName,
}: {
  target?: string | null | undefined;
  targetClass?: string | null | undefined;
  methodName?: string | null | undefined;
}) {
  if (!target || !targetClass) return null;
  return (
    <span
      className="text-xs text-muted-foreground"
      data-testid="text-recording-target"
    >
      {target === "testMethod"
        ? `→ [Test] ${methodName ?? ""} in ${targetClass}`
        : target === "beforeEach"
        ? `→ BeforeEachAsync in ${targetClass}`
        : `→ OneTimeSetUpAsync in ${targetClass}`}
    </span>
  );
}
