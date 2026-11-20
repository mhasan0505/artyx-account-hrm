import { getAgencyProfitAndLoss } from '@/lib/actions/agency-profit'
import { ProfitLossClient } from '@/components/finances/profit-loss-client'

type PeriodPreset = 'ytd' | 'qtd' | 'mtd'

function resolveDateRange(preset: PeriodPreset): { start: Date; end: Date } {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

  if (preset === 'mtd') {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end }
  }
  if (preset === 'qtd') {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
    return { start: new Date(now.getFullYear(), quarterStartMonth, 1), end }
  }
  return {
    start: new Date(now.getFullYear(), 0, 1),
    end: new Date(now.getFullYear(), 11, 31, 23, 59, 59),
  }
}

export default async function ProfitLossPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const sp = await searchParams
  const raw = (sp?.range || 'ytd').toLowerCase()
  const activePreset: PeriodPreset =
    raw === 'mtd' || raw === 'qtd' ? raw : 'ytd'

  const { start, end } = resolveDateRange(activePreset)

  const [accrual, cash] = await Promise.all([
    getAgencyProfitAndLoss(start, end, { basis: 'ACCRUAL' }),
    getAgencyProfitAndLoss(start, end, { basis: 'CASH' }),
  ])

  return (
    <ProfitLossClient
      accrual={accrual}
      cash={cash}
      activePreset={activePreset}
    />
  )
}
