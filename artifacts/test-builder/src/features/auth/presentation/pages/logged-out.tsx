import { useLocation } from "wouter";
import { LogIn } from "lucide-react";
import { Logo } from "@/shared/ui/shell/logo";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Footer } from "@/shared/ui/shell/footer";

export function LoggedOut() {
  const [, navigate] = useLocation();
  return (
    <div
      className="min-h-screen bg-background text-foreground flex flex-col"
      data-testid="screen-logged-out"
    >
      <header className="material-chrome border-b border-border shadow-nav dark:shadow-none px-8 py-5 flex items-center gap-3">
        <Logo className="text-xl" />
      </header>

      <main className="relative flex-1 flex items-center justify-center p-8 ambient-bg-soft">
        <Card className="w-full max-w-sm border-card-border shadow-card">
          <CardContent className="p-8">
            <div className="mb-6">
              <h1
                className="text-2xl font-semibold tracking-tight"
                data-testid="text-logged-out-title"
              >
                You've been signed out
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Your session has ended. You can sign back in whenever
                you're ready.
              </p>
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={() => navigate("/login", { replace: true })}
              data-testid="button-sign-in-again"
            >
              <LogIn className="h-4 w-4 mr-2" />
              Sign in again
            </Button>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
