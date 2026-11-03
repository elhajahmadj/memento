import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { motion, useReducedMotion } from "framer-motion";

const FLIGHT_DELAY_MS = 1900;
const FLIGHT_DURATION_MS = 500;
const LANDING_HOLD_MS = 450;
const FADE_OUT_MS = 450;
const SPLASH_DURATION_MS =
  FLIGHT_DELAY_MS + FLIGHT_DURATION_MS + LANDING_HOLD_MS + FADE_OUT_MS;
const REDUCED_MOTION_DURATION_MS = 400;

type Phase = "intro" | "flying" | "landed" | "leaving";

interface FlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FlightRects {
  source: FlightRect;
  target: FlightRect;
}

function rectFromElement(el: Element): FlightRect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * Read a same-origin relative path from the current URL's `?next=...`
 * query parameter. Returns "/" when the param is missing, malformed,
 * or points off-origin (anything not starting with a single "/").
 * Restricting to relative same-origin paths avoids open-redirect
 * issues — an attacker can't craft `/splash?next=//evil.example.com`
 * to bounce a freshly-authed user off our origin.
 */
function readSafeNext(): string {
  if (typeof window === "undefined") return "/";
  try {
    const raw = new URL(window.location.href).searchParams.get("next");
    if (!raw) return "/";
    // Must start with "/" but not "//" (protocol-relative) and not
    // "/\" (some browsers treat backslash as a path separator).
    if (!raw.startsWith("/")) return "/";
    if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
    return raw;
  } catch {
    return "/";
  }
}

export function Splash() {
  const [, navigate] = useLocation();
  const prefersReducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("intro");
  const [rects, setRects] = useState<FlightRects | null>(null);
  const nextRef = useRef<string>(readSafeNext());

  const sourceRef = useRef<HTMLSpanElement>(null);
  // Hidden, in-flow glyph that reserves the layout slot for the landed
  // lowercase "m" and provides a measurement target for the flying glyph.
  const measureRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const dest = nextRef.current;
    if (prefersReducedMotion) {
      const t = window.setTimeout(() => {
        navigate(dest, { replace: true });
      }, REDUCED_MOTION_DURATION_MS);
      return () => window.clearTimeout(t);
    }

    const measure = () => {
      if (sourceRef.current && measureRef.current) {
        setRects({
          source: rectFromElement(sourceRef.current),
          target: rectFromElement(measureRef.current),
        });
      }
    };

    const t1 = window.setTimeout(() => {
      measure();
      setPhase("flying");
    }, FLIGHT_DELAY_MS);
    const t2 = window.setTimeout(() => {
      setPhase("landed");
    }, FLIGHT_DELAY_MS + FLIGHT_DURATION_MS);
    const t3 = window.setTimeout(() => {
      setPhase("leaving");
    }, FLIGHT_DELAY_MS + FLIGHT_DURATION_MS + LANDING_HOLD_MS);
    const t4 = window.setTimeout(() => {
      navigate(dest, { replace: true });
    }, SPLASH_DURATION_MS);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
  }, [prefersReducedMotion, navigate]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const handleResize = () => {
      if (sourceRef.current && measureRef.current) {
        setRects({
          source: rectFromElement(sourceRef.current),
          target: rectFromElement(measureRef.current),
        });
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [prefersReducedMotion]);

  const wordRise = prefersReducedMotion
    ? { initial: false, animate: { opacity: 1, y: 0 } }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
      };

  const isFlying =
    phase === "flying" || phase === "landed" || phase === "leaving";
  const isLeaving = phase === "leaving";

  const flyingTargetX = rects
    ? rects.target.left + rects.target.width / 2 - rects.source.width / 2
    : 0;
  const flyingTargetY = rects
    ? rects.target.top + rects.target.height / 2 - rects.source.height / 2
    : 0;
  const landedScale = rects ? rects.target.height / rects.source.height : 1;

  return (
    <motion.div
      className="min-h-screen bg-background ambient-bg-soft flex items-center justify-center"
      data-testid="screen-splash"
      initial={{ opacity: 1 }}
      animate={{ opacity: prefersReducedMotion ? 1 : isLeaving ? 0 : 1 }}
      transition={{
        duration: FADE_OUT_MS / 1000,
        ease: [0.22, 1, 0.36, 1] as const,
      }}
    >
      <div className="flex flex-col items-center gap-5">
        <div className="flex flex-col items-center gap-3">
          <div className="text-5xl font-semibold tracking-tight font-display">
            <span ref={sourceRef} className="text-brand-gradient inline-block">
              m
            </span>
            <span className="text-muted-foreground">emento</span>
          </div>
          <div className="h-1 w-24 rounded-full bg-brand-gradient opacity-70" />
        </div>

        <div
          className="flex flex-row flex-wrap items-baseline justify-center gap-x-2 gap-y-1 text-2xl font-display font-medium tracking-tight text-muted-foreground"
          data-testid="splash-tagline"
        >
          <motion.span
            initial={wordRise.initial}
            animate={wordRise.animate}
            {...(prefersReducedMotion
              ? {}
              : { transition: { ...wordRise.transition, delay: 0.35 } })}
            data-testid="splash-tagline-record"
          >
            Record.
          </motion.span>
          <motion.span
            initial={wordRise.initial}
            animate={wordRise.animate}
            {...(prefersReducedMotion
              ? {}
              : { transition: { ...wordRise.transition, delay: 0.75 } })}
            data-testid="splash-tagline-build"
          >
            Build.
          </motion.span>
          <motion.span
            initial={wordRise.initial}
            animate={wordRise.animate}
            {...(prefersReducedMotion
              ? {}
              : { transition: { ...wordRise.transition, delay: 1.15 } })}
            className="inline-flex items-baseline"
            data-testid="splash-tagline-playwright"
          >
            <span>Play</span>
            <span className="relative inline-block">
              {/* Hidden in-flow glyph: reserves layout space for the
                  landed lowercase "m" and is the measurement target for
                  the flying glyph. The original test id is preserved so
                  existing test hooks continue to resolve a stable
                  element in this slot. */}
              <span
                ref={measureRef}
                aria-hidden="true"
                data-testid="splash-tagline-w"
                className="text-brand-gradient inline-block"
                style={{
                  visibility: "hidden",
                  pointerEvents: "none",
                  transform: "rotate(180deg)",
                }}
              >
                m
              </span>
              {/* Reduced-motion path: render a static rotated lowercase
                  "m" in place so users still see the final glyph
                  without any animation. */}
              {prefersReducedMotion && (
                <span
                  aria-hidden="true"
                  className="text-brand-gradient inline-flex items-center justify-center"
                  style={{
                    position: "absolute",
                    inset: 0,
                    transform: "rotate(180deg)",
                    pointerEvents: "none",
                  }}
                  data-testid="splash-glyph-static"
                >
                  m
                </span>
              )}
            </span>
            <span>right.</span>
          </motion.span>
        </div>
      </div>

      {/* Flying glyph: takes off from the "m" of "memento", lands as a
          rotated lowercase "m" in the W slot, then stays put while the
          splash fades out into the projects page. */}
      {isFlying && rects && !prefersReducedMotion && (
        <motion.span
          aria-hidden="true"
          data-testid="splash-flying-glyph"
          className="text-brand-gradient font-display font-semibold tracking-tight"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            pointerEvents: "none",
            zIndex: 50,
            lineHeight: 1,
            fontSize: rects.source.height,
            display: "inline-block",
            transformOrigin: "center",
            willChange: "transform",
          }}
          initial={{
            x: rects.source.left,
            y: rects.source.top,
            scale: 1,
            rotate: 0,
          }}
          animate={{
            x: flyingTargetX,
            y: flyingTargetY,
            scale: landedScale,
            rotate: 180,
          }}
          transition={{
            duration: FLIGHT_DURATION_MS / 1000,
            ease: [0.34, 1.56, 0.64, 1] as const,
          }}
        >
          m
        </motion.span>
      )}
    </motion.div>
  );
}
