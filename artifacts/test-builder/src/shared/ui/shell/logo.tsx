import { Link } from "wouter";
import { cn } from "@/shared/utils/utils";

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <Link
      href="/"
      aria-label="memento — go to home"
      className={cn(
        "font-semibold tracking-tight cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:opacity-90 transition-opacity",
        className,
      )}
      data-testid="logo-memento"
    >
      <span className="text-brand-gradient">m</span>
      <span className="text-muted-foreground">emento</span>
    </Link>
  );
}
