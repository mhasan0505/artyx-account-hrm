'use client'

import { useEffect, useState } from 'react'
import { getReportPrintMeta } from '@/lib/actions/print'

interface ReportPrintHeaderProps {
  title: string
  subtitle?: string
  dateRange?: string
  companyName?: string
}

export function ReportPrintHeader({
  title,
  subtitle,
  dateRange,
  companyName = 'Artyx Digital',
}: ReportPrintHeaderProps) {
  const [meta, setMeta] = useState<any>(null)

  useEffect(() => {
    getReportPrintMeta().then(res => setMeta(res)).catch(() => {})
  }, [])

  const currentDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const outletName = meta?.outletName
  const companyAddress = meta?.companyAddress
  const companyPhone = meta?.companyPhone
  const companyEmail = meta?.companyEmail
  const companyLogo = meta?.companyLogo || '/logo_icons.png'

  return (
    <div className="hidden print:block mb-4 pb-3 border-b-2 border-slate-900 w-full print:break-inside-avoid">
      <div className="flex justify-between items-start gap-6">
        {/* Left: Company Logo & Identity */}
        <div className="flex items-center gap-3">
          <img
            src={companyLogo}
            alt={companyName}
            className="h-16 w-16 object-contain shrink-0"
          />
          <div>
            <h2 className="text-2xl font-black uppercase tracking-tight text-slate-900 leading-tight">
              {companyName}
            </h2>
            {outletName && (
              <p className="text-xs font-semibold text-slate-700 mt-1">
                Outlet: {outletName}
              </p>
            )}
            {companyAddress && (
              <p className="text-[11px] text-slate-600 leading-tight mt-0.5 max-w-62.5">
                {companyAddress}
              </p>
            )}
            {(companyPhone || companyEmail) && (
              <p className="text-[10px] text-slate-500 mt-1">
                {[companyPhone, companyEmail].filter(Boolean).join(' • ')}
              </p>
            )}
          </div>
        </div>

        {/* Right: Report Title, Date & Metadata */}
        <div className="text-right">
          <h1 className="text-xl font-extrabold uppercase tracking-tight text-slate-900">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs text-slate-600 font-medium mt-0.5">
              {subtitle}
            </p>
          )}
          {dateRange && (
            <p className="text-xs text-slate-800 font-semibold mt-1">
              Period / Date: <span className="font-mono">{dateRange}</span>
            </p>
          )}
          <p className="text-[10px] text-slate-500 mt-1">
            Generated: {currentDate}
          </p>
        </div>
      </div>
    </div>
  )
}
