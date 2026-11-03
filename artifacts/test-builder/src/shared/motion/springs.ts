/**
 * Motion tokens — Apple's fluid-interface model, translated for the web.
 *
 * Apple deliberately replaced the physics triplet (mass / stiffness /
 * damping) with two designer-facing parameters, and those are the only
 * two we reason about here:
 *
 *   - **damping ratio** — controls overshoot. `1.0` is critically damped
 *     (no bounce, graceful settle); below `1.0` overshoots and
 *     oscillates.
 *   - **response** — how quickly the value reaches the target, in
 *     seconds. This is *not* a duration: a spring has no fixed duration,
 *     its settle time emerges from the parameters.
 *
 * Framer Motion's `bounce` + `duration` spring API maps closely onto
 * that pair, so each token below records the Apple values it encodes.
 *
 * House rule: default to critically damped (`bounce: 0`). Add bounce
 * **only when the gesture itself carried momentum** — a flick, a throw,
 * a drag release. Overshoot on a menu that merely faded in feels wrong;
 * overshoot on a card you flicked feels right.
 */

export type SpringToken = {
  readonly type: "spring";
  /** Framer Motion bounce — the inverse of Apple's damping ratio. */
  readonly bounce: number;
  /** Framer Motion duration, in seconds — Apple's "response". */
  readonly duration: number;
};

/**
 * The concrete values Apple ships for these interactions, from
 * *Designing Fluid Interfaces* (WWDC 2018).
 */
export const SPRING = {
  /**
   * Move / reposition (Apple: damping `1.0`, response `0.4`). The
   * default for anything that isn't momentum-driven.
   */
  move: { type: "spring", bounce: 0, duration: 0.4 },
  /** Rotation (Apple: damping `0.8`, response `0.4`). */
  rotate: { type: "spring", bounce: 0.2, duration: 0.4 },
  /** Drawer / sheet (Apple: damping `0.8`, response `0.3`). */
  sheet: { type: "spring", bounce: 0.2, duration: 0.3 },
  /**
   * Momentum release — a flick or throw has just happened, so a little
   * overshoot reads as physical rather than decorative.
   */
  momentum: { type: "spring", bounce: 0.2, duration: 0.4 },
} as const satisfies Record<string, SpringToken>;

/**
 * Reduced-motion equivalent. Reduced motion does not mean *no*
 * feedback — it means a gentler, non-vestibular one, so we keep the
 * opacity change (it aids comprehension) and drop the travel and the
 * overshoot.
 */
export const CROSS_FADE = { type: "tween", duration: 0.2, ease: "easeOut" } as const;

/**
 * Apple's momentum projection, from the *Designing Fluid Interfaces*
 * sample code: where would a flick come to rest if it decelerated like
 * scroll?
 *
 * Snap to the target nearest this projected point rather than the one
 * nearest the release point — that is what makes a flick feel like it
 * throws the element instead of dropping it.
 *
 * Note this is the exponential-decay form Apple actually ships, not the
 * physics-textbook `v² / (2·deceleration)`.
 *
 * @param initialVelocity release velocity, in px/s
 * @param decelerationRate `0.998` for a normal scroll feel, `0.99` snappier
 * @returns the distance the gesture would still travel, in px
 */
export function project(initialVelocity: number, decelerationRate = 0.998): number {
  return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Progressive resistance past a boundary. A hard stop reads as
 * "frozen"; continuous resistance reads as "responsive, but there is
 * nothing more here".
 *
 * @param overshoot how far past the boundary the pointer has travelled, in px
 * @param dimension the size of the dragged surface along that axis, in px
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * Normalize a gesture velocity for spring APIs that expect velocity
 * relative to the remaining distance.
 *
 * Framer Motion takes absolute px/s in its `velocity` option, so you
 * usually hand it the raw value — reach for this only for an API that
 * wants the normalized form.
 */
export function relativeVelocity(
  gestureVelocity: number,
  targetValue: number,
  currentValue: number,
): number {
  const remaining = targetValue - currentValue;
  return remaining === 0 ? 0 : gestureVelocity / remaining;
}
