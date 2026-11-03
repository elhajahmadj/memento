import {
  FolderOpen,
  Wrench,
  Settings as SettingsIcon,
  BookOpen,
  Hammer,
  Info,
  ShieldCheck,
  Home as HomeIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof FolderOpen;
  adminOnly?: boolean;
  publicOnly?: boolean;
  /**
   * Hidden from guest trial sessions. Distinct from `adminOnly`: these
   * are surfaces a regular User can reach but a guest cannot.
   */
  hideForGuest?: boolean;
  matchPrefix?: string;
}

export const NAV_ITEMS: NavItem[] = [
  // Hidden from guests: `/` redirects them straight to /projects, so a
  // Home link would be a no-op that lands on the page they're already on.
  { href: "/", label: "Home", icon: HomeIcon, matchPrefix: "/", hideForGuest: true },
  { href: "/projects", label: "Projects", icon: FolderOpen, matchPrefix: "/projects" },
  { href: "/workbench", label: "Workstation", icon: Hammer, matchPrefix: "/workbench" },
  { href: "/admin", label: "Admin", icon: ShieldCheck, matchPrefix: "/admin", adminOnly: true },
  { href: "/tools", label: "Tools", icon: Wrench, matchPrefix: "/tools", adminOnly: true },
  // Hidden from guests: Mocks / Shared steps / Architectures are all
  // closed to them server-side, leaving only Appearance — not worth a
  // nav slot, and the page would look broken.
  { href: "/settings", label: "Settings", icon: SettingsIcon, matchPrefix: "/settings", hideForGuest: true },
  { href: "/documentation", label: "Documentation", icon: BookOpen, matchPrefix: "/documentation", hideForGuest: true },
  { href: "/about", label: "About", icon: Info, matchPrefix: "/about", publicOnly: true },
];

export function filterNavItems(
  signedIn: boolean,
  isAnyAdmin: boolean,
  isGuest = false,
): NavItem[] {
  return NAV_ITEMS.filter((i) => {
    if (!signedIn) {
      // Logged-out visitors only ever land on public pages, so hide every
      // link that would just bounce them to /login.
      return i.href === "/about";
    }
    if (isGuest && i.hideForGuest) return false;
    return !i.adminOnly || isAnyAdmin;
  });
}

export function isNavItemActive(item: NavItem, location: string): boolean {
  if (item.href === "/") {
    // Home is "/" exactly — must not stay highlighted while on
    // /projects, /workbench, or any other route.
    return location === "/" || location === "";
  }
  return (
    location === item.matchPrefix ||
    location.startsWith(`${item.matchPrefix}/`)
  );
}
