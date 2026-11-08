'use client'

interface ReportPrintFooterProps {
  preparedBy?: string
  approvedBy?: string
}

export function ReportPrintFooter({
  preparedBy = 'Prepared By',
  approvedBy = 'Authorized Signature',
}: ReportPrintFooterProps) {
  return (
    <div className="hidden print:block mt-8 pt-3 break-inside-avoid">
      <div className="grid grid-cols-2 mt-6 gap-12 text-center text-xs text-slate-800">
        <div>
          <div className="border-t border-slate-800 w-52 mx-auto pt-2 mb-1 font-semibold text-[10px] uppercase tracking-wider text-slate-900">
            {preparedBy}
          </div>
          <p className="text-[9px] text-slate-500 font-medium">
            Staff Signature & Date
          </p>
        </div>
        <div>
          <div className="border-t border-slate-800 w-52 mx-auto pt-2 mb-1 font-semibold text-[10px] uppercase tracking-wider text-slate-900">
            {approvedBy}
          </div>
          <p className="text-[9px] text-slate-500 font-medium">
            Management Approval
          </p>
        </div>
      </div>
    </div>
  )
}
