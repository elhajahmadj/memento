import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTourState,
  useSetTourSeen,
  getGetTourStateQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { X, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";

/**
 * 5-step coachmark onboarding tour. Renders nothing until `hasSeenTour`
 * has been confirmed `false` for the current user. Each step is a small
 * portal-style overlay anchored at the viewport center; in this
 * implementation we keep things simple and skip DOM-target highlighting,
 * relying on plain copy + a translucent backdrop.
 *
 * Closing or finishing the tour POSTs `hasSeenTour: true` so it never
 * shows again for that user. The Help menu can re-open it by passing
 * `forceOpen` (handled upstream).
 */
const STEPS: { title: string; body: string }[] = [
  {
    title: "Welcome to Test Builder",
    body: "Record real user journeys, then replay them as Playwright tests in C#, Python, Node.js, or Java.",
  },
  {
    title: "Start a recording",
    body: "Open a project, pick a test class, and click Start Recording. Every click, fill, and navigation is captured.",
  },
  {
    title: "Add assertions on the fly",
    body: "Use the Add Assertion button — and the new Add API Check — to verify text, URLs, accessibility, visual regressions, and HTTP responses.",
  },
  {
    title: "Mock the network",
    body: "Open Settings → Mocks to add canned responses for any URL pattern. They run during both recording and replay.",
  },
  {
    title: "Validate your tests",
    body: "Hit Validate to replay any saved recording in headless Playwright. Failing accessibility scans and visual diffs surface in the run dashboard.",
  },
];

export function OnboardingTour({
  forceOpen = false,
  onClose,
}: {
  forceOpen?: boolean;
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useGetTourState();
  const setSeen = useSetTourSeen({
    mutation: {
      onSettled: async () => {
        await qc.invalidateQueries({ queryKey: getGetTourStateQueryKey() });
      },
    },
  });
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (forceOpen) {
      setStep(0);
      setOpen(true);
      return;
    }
    if (!isLoading && data && data.hasSeenTour === false) {
      setStep(0);
      setOpen(true);
    }
  }, [forceOpen, isLoading, data]);

  useEffect(() => {
    const onRelaunch = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener("onboarding:relaunch", onRelaunch);
    return () =>
      window.removeEventListener("onboarding:relaunch", onRelaunch);
  }, []);

  const finish = (markSeen: boolean) => {
    setOpen(false);
    if (markSeen) {
      setSeen.mutate({ data: { hasSeenTour: true } });
    }
    onClose?.();
  };

  if (!open) return null;
  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      data-testid="onboarding-tour-overlay"
      onClick={() => finish(true)}
    >
      <Card
        className="max-w-md w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="onboarding-tour-card"
      >
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Step {step + 1} of {STEPS.length}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => finish(true)}
              data-testid="button-tour-close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <h2 className="text-xl font-semibold" data-testid="text-tour-title">
            {current.title}
          </h2>
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-tour-body"
          >
            {current.body}
          </p>
          <div className="flex items-center justify-between pt-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              data-testid="button-tour-prev"
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <div className="flex gap-1">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={
                    "h-1.5 w-6 rounded-full " +
                    (i === step ? "bg-primary" : "bg-muted")
                  }
                />
              ))}
            </div>
            {isLast ? (
              <Button
                size="sm"
                onClick={() => finish(true)}
                data-testid="button-tour-finish"
              >
                Got it
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                data-testid="button-tour-next"
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
