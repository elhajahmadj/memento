import { useEffect } from "react";
import { useLocation } from "wouter";

export function RedirectTo({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    const hashIdx = to.indexOf("#");
    if (hashIdx >= 0) {
      const path = to.slice(0, hashIdx);
      const hash = to.slice(hashIdx);
      navigate(path, { replace: true });
      if (typeof window !== "undefined") {
        window.location.hash = hash;
      }
    } else {
      navigate(to, { replace: true });
    }
  }, [navigate, to]);
  return null;
}
