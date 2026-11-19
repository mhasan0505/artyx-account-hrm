'use client'

import type {
  NotificationCategoryType,
  NotificationPriorityType,
} from './types'

let sharedAudioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!sharedAudioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!Ctx) return null
      sharedAudioCtx = new Ctx()
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {})
    }
    return sharedAudioCtx
  } catch {
    return null
  }
}

/**
 * Unlocks Web Audio on the first user click/keydown so background notifications can chime.
 */
export function primeNotificationAudio() {
  if (typeof window === 'undefined') return
  const unlock = () => {
    const ctx = getAudioContext()
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }
  }
  window.addEventListener('pointerdown', unlock, { once: true, passive: true })
  window.addEventListener('keydown', unlock, { once: true, passive: true })
}

function playTone(
  ctx: AudioContext,
  freq: number,
  startOffset: number,
  duration: number,
  peakGain: number,
  type: OscillatorType = 'sine'
) {
  const now = ctx.currentTime + startOffset
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, now)

  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.linearRampToValueAtTime(peakGain, now + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + duration + 0.02)
}

/**
 * Plays a refined harmonic chime tailored to the notification's priority & category.
 */
export function playNotificationChime(
  category: NotificationCategoryType = 'SYSTEM',
  priority: NotificationPriorityType = 'NORMAL'
) {
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    if (priority === 'URGENT') {
      // Crisp double-pulse urgent executive chime (G5 -> B5 -> D6, repeat)
      playTone(ctx, 783.99, 0, 0.14, 0.08, 'triangle')
      playTone(ctx, 987.77, 0.09, 0.16, 0.08, 'triangle')
      playTone(ctx, 1174.66, 0.2, 0.24, 0.09, 'sine')
      return
    }

    if (category === 'CHAT') {
      // Soft modern chat pop (E5 -> A5)
      playTone(ctx, 659.25, 0, 0.11, 0.055, 'sine')
      playTone(ctx, 880.0, 0.07, 0.15, 0.05, 'sine')
      return
    }

    if (category === 'PAYMENT' || category === 'INVOICE' || category === 'EQUITY') {
      // Pleasant financial bell triad (C5 -> E5 -> G5)
      playTone(ctx, 523.25, 0, 0.14, 0.05, 'sine')
      playTone(ctx, 659.25, 0.08, 0.16, 0.055, 'sine')
      playTone(ctx, 783.99, 0.16, 0.22, 0.05, 'sine')
      return
    }

    if (category === 'EXECUTIVE_TASK' || priority === 'HIGH') {
      // Crisp ascending fifth (D5 -> A5)
      playTone(ctx, 587.33, 0, 0.13, 0.06, 'sine')
      playTone(ctx, 880.0, 0.09, 0.2, 0.065, 'sine')
      return
    }

    // Standard subtle executive chime (F5 -> A5)
    playTone(ctx, 698.46, 0, 0.12, 0.045, 'sine')
    playTone(ctx, 880.0, 0.08, 0.16, 0.04, 'sine')
  } catch {
    // Never break UI if browser blocks audio
  }
}
