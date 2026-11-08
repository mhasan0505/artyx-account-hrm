import React from 'react'

interface ReportCodeBlockProps {
  children: React.ReactNode
  variant?: 'inline' | 'block'
  className?: string
}

/**
 * Isolated, high-contrast monospace code and token block for POS transaction tokens,
 * invoice numbers, SKUs, and embedded audit logs.
 *
 * Designed with a crisp light-gray background, explicit border, and deep black/slate text
 * to guarantee optimal legibility in print and PDF outputs.
 */
export function ReportCodeBlock({
  children,
  variant = 'inline',
  className = '',
}: ReportCodeBlockProps) {
  if (variant === 'inline') {
    return (
      <span
        className={`inline-flex items-center align-top px-1.5 py-0.5 font-mono text-[11px] print:text-[8px] font-medium text-slate-900 bg-slate-100 border border-slate-300 rounded shadow-none select-all tracking-tight ${className}`}
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      >
        {children}
      </span>
    )
  }

  return (
    <pre
      className={`p-2.5 my-1.5 font-mono text-xs print:text-[8.5px] leading-relaxed text-slate-900 bg-slate-50 border border-slate-300 rounded-md overflow-x-auto whitespace-pre-wrap break-words print:break-inside-avoid shadow-none ${className}`}
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      }}
    >
      <code>{children}</code>
    </pre>
  )
}
