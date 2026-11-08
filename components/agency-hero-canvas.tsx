'use client'

import * as React from 'react'

export function AgencyHeroCanvas() {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number
    let width = 0
    let height = 0

    // Particle nodes
    const nodeCount = 38
    type Particle = {
      x: number
      y: number
      vx: number
      vy: number
      radius: number
      alpha: number
    }

    const particles: Particle[] = []

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = rect.width
      height = rect.height
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.scale(dpr, dpr)
    }

    resize()
    window.addEventListener('resize', resize)

    // Initialize particles
    for (let i = 0; i < nodeCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        radius: Math.random() * 1.8 + 1,
        alpha: Math.random() * 0.45 + 0.2,
      })
    }

    let mouseX = -1000
    let mouseY = -1000

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouseX = e.clientX - rect.left
      mouseY = e.clientY - rect.top
    }

    const onMouseLeave = () => {
      mouseX = -1000
      mouseY = -1000
    }

    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mouseleave', onMouseLeave)

    const render = () => {
      ctx.clearRect(0, 0, width, height)

      // Connect particles
      for (let i = 0; i < particles.length; i++) {
        const p1 = particles[i]

        p1.x += p1.vx
        p1.y += p1.vy

        if (p1.x < 0) p1.x = width
        else if (p1.x > width) p1.x = 0
        if (p1.y < 0) p1.y = height
        else if (p1.y > height) p1.y = 0

        // Draw particle node
        ctx.beginPath()
        ctx.arc(p1.x, p1.y, p1.radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(127, 255, 0, ${p1.alpha})`
        ctx.fill()

        // Connect to nearby particles
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j]
          const dx = p1.x - p2.x
          const dy = p1.y - p2.y
          const dist = Math.sqrt(dx * dx + dy * dy)

          if (dist < 90) {
            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.strokeStyle = `rgba(127, 255, 0, ${(1 - dist / 90) * 0.18})`
            ctx.lineWidth = 0.75
            ctx.stroke()
          }
        }

        // Connect to mouse pointer
        const mdx = p1.x - mouseX
        const mdy = p1.y - mouseY
        const mdist = Math.sqrt(mdx * mdx + mdy * mdy)
        if (mdist < 130) {
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(mouseX, mouseY)
          ctx.strokeStyle = `rgba(127, 255, 0, ${(1 - mdist / 130) * 0.35})`
          ctx.lineWidth = 1
          ctx.stroke()
        }
      }

      animationFrameId = requestAnimationFrame(render)
    }

    render()

    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 size-full pointer-events-auto opacity-70 dark:opacity-85 mix-blend-screen"
    />
  )
}
