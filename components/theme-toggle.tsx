'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="size-9 rounded-xl border border-border bg-card text-muted-foreground shadow-2xs opacity-50"
        aria-label="Toggle theme"
      >
        <Moon className="size-3.5" />
      </Button>
    )
  }

  const isDark = resolvedTheme === 'dark' || theme === 'dark'

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={className ?? "size-9 rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-95 shadow-2xs transition-all cursor-pointer"}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      {isDark ? (
        <Sun className="size-3.5 text-lime transition-transform duration-200 hover:rotate-45" />
      ) : (
        <Moon className="size-3.5 text-primary transition-transform duration-200 hover:-rotate-12" />
      )}
    </Button>
  )
}
