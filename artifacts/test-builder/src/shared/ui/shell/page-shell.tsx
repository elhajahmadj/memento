import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { TopNav } from "@/shared/ui/shell/top-nav";
import { SideNavLayout } from "@/shared/ui/shell/side-nav";
import { Footer } from "@/shared/ui/shell/footer";
import { cn } from "@/shared/utils/utils";
import { useNavLayout } from "@/shared/hooks/use-nav-layout";

interface PageShellProps {
  children: ReactNode;
  contentClassName?: string;
  mainClassName?: string;
  backTestId?: string;
  backTo?: string;
  backLabel?: string;
  showBack?: boolean;
  showUserMenu?: boolean;
}

export function PageShell({
  children,
  contentClassName,
  mainClassName,
  backTestId = "button-page-back",
  backTo = "/",
  backLabel = "Back",
  showBack = true,
  showUserMenu: _showUserMenu = true,
}: PageShellProps) {
  const [, navigate] = useLocation();
  const { layout } = useNavLayout();

  const body = (
    <>
      <main className={cn("relative flex-1 p-8", mainClassName)}>
        <div className={cn("mx-auto", contentClassName)}>
          {showBack && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(backTo)}
              className="mb-4 -ml-2"
              data-testid={backTestId}
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> {backLabel}
            </Button>
          )}
          {children}
        </div>
      </main>
      <Footer />
    </>
  );

  if (layout === "side") {
    return (
      <div className="min-h-screen bg-background text-foreground flex">
        <SideNavLayout>{body}</SideNavLayout>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <TopNav />
      {body}
    </div>
  );
}
