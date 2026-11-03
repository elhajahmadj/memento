import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import {
  useCreateDemoProject,
  getGetCurrentProjectQueryKey,
  getGetProjectTreeQueryKey,
  getListTestClassesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";

/**
 * "Try the demo" call-to-action shown on the projects home page. Hits
 * the idempotent `/projects/demo` endpoint that scaffolds a sample
 * `MementoDemo` C# solution seeded with two recorded test methods,
 * a sample mock rule, and an accessibility assertion — so newcomers
 * can hit "Validate" and see the Tier 3 features end-to-end without
 * recording anything themselves.
 */
export function DemoCard({ className }: { className?: string }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const create = useCreateDemoProject({
    mutation: {
      onSuccess: async () => {
        toast.success("Demo project ready");
        // Invalidate every query the workbench will fire on mount so we
        // don't navigate into a stale "no project loaded" state and so
        // the Explorer / test list don't sit on cached errors from a
        // previous failed attempt.
        await Promise.all([
          qc.invalidateQueries({
            queryKey: getGetCurrentProjectQueryKey(),
          }),
          qc.invalidateQueries({
            queryKey: getGetProjectTreeQueryKey(),
          }),
          qc.invalidateQueries({
            queryKey: getListTestClassesQueryKey(),
          }),
        ]);
        navigate("/workbench");
      },
      onError: (e: Error) =>
        toast.error(e.message ?? "Failed to set up demo project"),
    },
  });

  return (
    <Card
      className={
        "border-card-border ambient-bg-soft " + (className ?? "")
      }
      data-testid="card-try-the-demo"
    >
      <CardContent className="p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-brand-gradient-soft border border-primary/20 flex items-center justify-center shrink-0">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold">Try the demo</h3>
          <p className="text-sm text-muted-foreground">
            Scaffold the <code className="font-mono">MementoDemo</code> sample
            project with two pre-recorded test methods, a network mock, and an
            accessibility assertion already wired up.
          </p>
        </div>
        <Button
          onClick={() => create.mutate()}
          disabled={create.isPending}
          data-testid="button-try-demo"
        >
          {create.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Setting up…
            </>
          ) : (
            <>Try the demo</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
