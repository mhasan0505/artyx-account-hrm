import type { Transition, Variants } from 'framer-motion'

/**
 * Artyx motion system — a single source of truth for timing and easing.
 *
 * Governed by `.agents` motion-design + genjutsu guidelines:
 *  - micro-interactions: 120–180ms
 *  - UI transitions (modal, drawer, tab): ~240ms
 *  - page / view transitions: ~360ms
 *  - entrance = decelerate, exit = accelerate
 *
 * Numbers are in seconds because framer-motion takes seconds.
 */

export const DURATION = {
  instant: 0.12,
  fast: 0.18,
  base: 0.24,
  slow: 0.36,
} as const

export type MotionDuration = keyof typeof DURATION

type Bezier = [number, number, number, number]

export const EASE: Record<'mechanical' | 'entrance' | 'exit' | 'inout', Bezier> = {
  mechanical: [0.16, 1, 0.3, 1],
  entrance: [0.16, 1, 0.3, 1],
  exit: [0.4, 0, 1, 1],
  inout: [0.4, 0, 0.2, 1],
}

export const TRANSITION: Record<MotionDuration, Transition> = {
  instant: { duration: DURATION.instant, ease: EASE.mechanical },
  fast: { duration: DURATION.fast, ease: EASE.mechanical },
  base: { duration: DURATION.base, ease: EASE.mechanical },
  slow: { duration: DURATION.slow, ease: EASE.entrance },
}

/* ── Reusable entrance presets ─────────────────────────────────────────── */

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: TRANSITION.base },
}

export const slideUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: TRANSITION.base },
}

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: TRANSITION.fast },
}

/* ── Orchestrated entrance ─────────────────────────────────────────────── */

/**
 * Parent container that staggers its children. Keep the total budget under
 * 500ms — the default 0.06s across six items lands at 360ms.
 */
export function staggerContainer(
  staggerChildren = 0.06,
  delayChildren = 0
): Variants {
  return {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren, delayChildren },
    },
  }
}

/** Child item to pair with {@link staggerContainer}. */
export function listItem(distance = 12): Variants {
  return {
    hidden: { opacity: 0, y: distance },
    show: { opacity: 1, y: 0, transition: TRANSITION.base },
  }
}

/* ── Reduced-motion ────────────────────────────────────────────────────── */

const SPATIAL_KEYS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'] as const

/**
 * Neutralises spatial motion while keeping opacity, so a user who prefers
 * reduced motion still sees content appear without anything sliding.
 *
 * Pass the boolean from framer-motion's `useReducedMotion()`:
 *
 *   const reduce = useReducedMotion()
 *   const container = resolveMotion(staggerContainer(0.06), reduce)
 */
export function resolveMotion(variants: Variants, reduce: boolean | null): Variants {
  if (!reduce) return variants

  return Object.fromEntries(
    Object.entries(variants).map(([key, value]) => {
      const target = value as Record<string, unknown>
      const clean: Record<string, unknown> = { ...target }

      for (const prop of SPATIAL_KEYS) {
        if (prop in clean) {
          clean[prop] = prop === 'rotate' ? 0 : prop === 'scale' ? 1 : 0
        }
      }
      if (!('opacity' in clean)) clean.opacity = 1
      clean.transition = { duration: 0 }

      return [key, clean]
    })
  ) as Variants
}
