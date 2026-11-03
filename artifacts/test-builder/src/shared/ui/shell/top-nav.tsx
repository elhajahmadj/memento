import { Link, useLocation } from "wouter";
import { LogIn } from "lucide-react";
import { Logo } from "@/shared/ui/shell/logo";
import { Button } from "@/shared/ui/button";
import { UserMenu } from "@/features/auth/presentation/user-menu";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { useIsAnyAdmin, useIsGuest } from "@/features/auth/presentation/role";
import { cn } from "@/shared/utils/utils";
import { filterNavItems, isNavItemActive } from "./nav-items";

export function TopNav() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const isAnyAdmin = useIsAnyAdmin();
  const signedIn = Boolean(user);

  const isGuest = useIsGuest();
  const items = filterNavItems(signedIn, isAnyAdmin, isGuest);

  return (
    // Floating translucent chrome: content scrolls underneath the bar,
    // and where the two meet the content fades out (`scroll-edge`)
    // instead of being cut off by a 1px rule.
    <header className="sticky top-0 z-30 material-chrome scroll-edge shadow-nav dark:shadow-none px-6 py-3 flex items-center gap-6">
      <Logo className="text-lg" />
      <nav className="flex items-center gap-1" aria-label="Primary">
        {items.map((item) => {
          const active = isNavItemActive(item, location);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={`nav-link-${item.label.toLowerCase()}`}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-all hover-elevate",
                active
                  ? "bg-brand-gradient-soft text-foreground border border-primary/20 shadow-sm"
                  : "text-muted-foreground hover:text-foreground border border-transparent",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon
                className={cn(
                  "h-3.5 w-3.5",
                  active && "text-primary",
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto">
        {signedIn ? (
          <UserMenu />
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={() => navigate("/login")}
            data-testid="top-nav-login-button"
          >
            <LogIn className="h-4 w-4 mr-2" />
            Login
          </Button>
        )}
      </div>
    </header>
  );
}
