import * as React from "react"
import { type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export interface EmptyStateAction {
  label: string
  onClick?: () => void
  href?: string
  icon?: LucideIcon | React.ComponentType<{ className?: string }>
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link"
    | "success"
    | "warning"
}

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon | React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: EmptyStateAction
  children?: React.ReactNode
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-border/80 bg-card/40 p-10 text-center transition-all animate-in fade-in-50",
        className
      )}
      {...props}
    >
      {Icon && (
        <div className="mx-auto w-12 h-12 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground mb-3 shadow-inner">
          <Icon className="w-6 h-6" />
        </div>
      )}
      <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
          {description}
        </p>
      )}
      {action &&
        (action.href ? (
          <Button
            asChild
            variant={action.variant || "outline"}
            size="sm"
            className="text-xs h-8 px-3 gap-1.5"
          >
            <Link href={action.href}>
              {action.icon && <action.icon className="w-3.5 h-3.5" />}
              {action.label}
            </Link>
          </Button>
        ) : (
          <Button
            variant={action.variant || "outline"}
            size="sm"
            onClick={action.onClick}
            className="text-xs h-8 px-3 gap-1.5"
          >
            {action.icon && <action.icon className="w-3.5 h-3.5" />}
            {action.label}
          </Button>
        ))}
      {children}
    </div>
  )
}
