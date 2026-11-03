import { Link, useLocation } from "wouter";
import { LogIn } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/shared/ui/sidebar";
import { Logo } from "@/shared/ui/shell/logo";
import { Button } from "@/shared/ui/button";
import { UserMenu } from "@/features/auth/presentation/user-menu";
import { useAuth } from "@/features/auth/presentation/auth-context";
import { useIsAnyAdmin, useIsGuest } from "@/features/auth/presentation/role";
import { filterNavItems, isNavItemActive } from "./nav-items";
import type { ReactNode } from "react";

interface SideNavLayoutProps {
  children: ReactNode;
}

/**
 * Wraps the page content with a left-hand side nav that mirrors the
 * destinations, role-gating, active-route highlighting, user menu and
 * org switcher in the top bar. Reuses the shared `Sidebar` primitive.
 */
export function SideNavLayout({ children }: SideNavLayoutProps) {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const isAnyAdmin = useIsAnyAdmin();
  const signedIn = Boolean(user);
  const isGuest = useIsGuest();
  const items = filterNavItems(signedIn, isAnyAdmin, isGuest);

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="none" data-testid="side-nav">
        <SidebarHeader>
          <div className="px-2 py-2">
            <Logo className="text-lg" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {items.map((item) => {
              const active = isNavItemActive(item, location);
              const Icon = item.icon;
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    data-testid={`side-nav-link-${item.label.toLowerCase()}`}
                  >
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          {signedIn ? (
            <UserMenu />
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => navigate("/login")}
              data-testid="side-nav-login-button"
            >
              <LogIn className="h-4 w-4 mr-2" />
              Login
            </Button>
          )}
        </SidebarFooter>
      </Sidebar>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </SidebarProvider>
  );
}
