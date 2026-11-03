import { useLocation } from "wouter";
import { LogIn } from "lucide-react";
import { Logo } from "@/shared/ui/shell/logo";
import { Button } from "@/shared/ui/button";
import { Footer } from "@/shared/ui/shell/footer";

export function Landing() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="material-chrome border-b border-border shadow-nav dark:shadow-none px-8 py-5 flex items-center justify-between gap-3">
        <Logo className="text-xl" />
        <Button
          type="button"
          onClick={() => navigate("/login")}
          data-testid="landing-login-button"
        >
          <LogIn className="h-4 w-4 mr-2" />
          Login
        </Button>
      </header>

      <main className="relative flex-1 flex items-center justify-center p-8 ambient-bg-soft overflow-hidden">
        <div
          className="absolute inset-0 flex items-center justify-center font-semibold tracking-tight text-[40vw] md:text-[32vw] leading-none select-none opacity-15 dark:opacity-20 pointer-events-none"
          aria-hidden="true"
          data-testid="landing-logo"
        >
          <span className="text-brand-gradient">m</span>
        </div>
        <div
          className="relative z-10 max-w-3xl mx-auto text-center flex flex-col items-center gap-6 px-4"
          data-testid="landing-hero"
        >
          <h1 className="text-6xl md:text-8xl font-semibold tracking-tight">
            <span className="text-brand-gradient">m</span>
            <span className="text-foreground">emento</span>
          </h1>
          <p className="text-sm md:text-base text-muted-foreground leading-relaxed max-w-2xl">
            Generate clean, maintainable test code by recording user actions
            or describing APIs. Built for QA engineers, SDETs, and
            non-technical teams—with speed, accuracy, and scalability.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
