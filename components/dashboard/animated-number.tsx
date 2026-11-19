'use client'

import * as React from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

gsap.registerPlugin(useGSAP)

type AnimatedNumberProps = {
  value: number
  prefix?: string
  suffix?: string
  decimals?: number
  compact?: boolean
  duration?: number
  className?: string
  prefixClassName?: string
}

function formatValue(value: number, decimals: number, compact: boolean): string {
  if (compact) {
    const abs = Math.abs(value)
    const sign = value < 0 ? '-' : ''
    if (abs >= 1_000_000) {
      return `${sign}${(abs / 1_000_000).toFixed(2)}M`
    }
    if (abs >= 1_000) {
      return `${sign}${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`
    }
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function AnimatedNumber({
  value,
  prefix,
  suffix,
  decimals = 0,
  compact = false,
  duration = 0.65,
  className,
  prefixClassName,
}: AnimatedNumberProps) {
  const reduce = useReducedMotion()
  const numberRef = React.useRef<HTMLSpanElement | null>(null)
  const proxyRef = React.useRef({ val: reduce ? value : 0 })
  const hasAnimatedRef = React.useRef(false)

  useGSAP(
    () => {
      const el = numberRef.current
      if (!el) return

      if (reduce) {
        proxyRef.current.val = value
        el.textContent = formatValue(value, decimals, compact)
        return
      }

      const startFrom = hasAnimatedRef.current ? proxyRef.current.val : value * 0.35
      proxyRef.current.val = startFrom
      hasAnimatedRef.current = true

      gsap.to(proxyRef.current, {
        val: value,
        duration,
        ease: 'power3.out',
        onUpdate: () => {
          if (numberRef.current) {
            numberRef.current.textContent = formatValue(
              proxyRef.current.val,
              decimals,
              compact
            )
          }
        },
        onComplete: () => {
          if (numberRef.current) {
            numberRef.current.textContent = formatValue(value, decimals, compact)
          }
        },
      })
    },
    { dependencies: [value, decimals, compact, duration, reduce] }
  )

  return (
    <span className={cn('inline-flex items-baseline tabular-nums', className)}>
      {prefix ? (
        <span className={cn('mr-0.5 font-normal opacity-60', prefixClassName)}>
          {prefix}
        </span>
      ) : null}
      <span ref={numberRef}>{formatValue(value, decimals, compact)}</span>
      {suffix ? <span className="ml-0.5">{suffix}</span> : null}
    </span>
  )
}
