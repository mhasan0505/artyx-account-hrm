import * as React from "react"
import { cn } from "@/lib/utils"

export type PosStatusType =
  | "paid"
  | "completed"
  | "in_stock"
  | "active"
  | "success"
  | "partial"
  | "low_stock"
  | "pending"
  | "warning"
  | "due"
  | "unpaid"
  | "overdue"
  | "out_of_stock"
  | "void"
  | "danger"
  | "hold"
  | "draft"
  | "transit"
  | "info"
  | "refunded"
  | "returned"
  | "cancelled"
  | "archived"
  | "neutral"
  | (string & {})

export interface PosStatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Status identifier (case-insensitive, e.g., "paid", "LOW_STOCK", "due", "hold") */
  status: PosStatusType
  /** Optional custom display text (defaults to human-formatted status e.g., "Low Stock") */
  label?: string
  /** Whether to show the subtle 6px status indicator dot (default: true) */
  showDot?: boolean
  /** Additional custom class names */
  className?: string
}

/**
 * Formats machine status codes into clean title case.
 * e.g., "LOW_STOCK" -> "Low Stock", "in_transit" -> "In Transit"
 */
export function formatStatusLabel(status: string): string {
  if (!status) return ""
  return status
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}

/**
 * Maps any normalized status string to the corresponding POS badge class.
 */
export function getPosBadgeClass(status: string): string {
  if (!status) return "pos-badge-refunded"

  const normalized = status.toLowerCase().trim().replace(/[\s-]+/g, "_")

  // Directly pass through if full class name was provided
  if (normalized.startsWith("pos_badge_") || normalized.startsWith("pos-badge-")) {
    return normalized.replace(/_/g, "-")
  }

  switch (normalized) {
    // Emerald: Paid / Completed / In Stock / Active / Success
    case "paid":
    case "completed":
    case "in_stock":
    case "instock":
    case "active":
    case "success":
    case "fulfilled":
    case "delivered":
    case "approved":
    case "received":
      return "pos-badge-paid"

    // Amber: Partial / Low Stock / Pending / In Progress
    case "partial":
    case "partially_paid":
    case "partiallypaid":
    case "low_stock":
    case "lowstock":
    case "pending":
    case "warning":
    case "processing":
    case "in_progress":
      return "pos-badge-partial"

    // Rose/Red: Due / Unpaid / Overdue / Out of Stock / Void / Danger
    case "due":
    case "unpaid":
    case "overdue":
    case "out_of_stock":
    case "outofstock":
    case "void":
    case "voided":
    case "danger":
    case "failed":
    case "rejected":
      return "pos-badge-due"

    // Indigo/Brand: On Hold / Draft / Transit / Info
    case "hold":
    case "on_hold":
    case "draft":
    case "transit":
    case "in_transit":
    case "info":
    case "review":
      return "pos-badge-hold"

    // Neutral Zinc: Refunded / Returned / Cancelled / Archived (and fallback)
    case "refunded":
    case "returned":
    case "cancelled":
    case "canceled":
    case "archived":
    case "neutral":
    default:
      return "pos-badge-refunded"
  }
}

/**
 * Reusable POS Semantic Status Badge component.
 * Uses soft tints with crisp borders for maximum legibility in dense tables.
 *
 * Usage:
 * `<PosStatusBadge status="paid" />`
 * `<PosStatusBadge status="low_stock" showDot={true} />`
 * `<PosStatusBadge status="due" label="Overdue (14d)" />`
 */
export function PosStatusBadge({
  status,
  label,
  showDot = true,
  className,
  ...props
}: PosStatusBadgeProps) {
  const badgeClass = getPosBadgeClass(status)
  const displayText = label ?? formatStatusLabel(status)

  return (
    <span
      className={cn("pos-badge", badgeClass, className)}
      {...props}
    >
      {showDot && <span className="pos-badge-dot" aria-hidden="true" />}
      <span>{displayText}</span>
    </span>
  )
}

export default PosStatusBadge
