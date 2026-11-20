import { getCeoCapTableData } from '@/lib/actions/ceo-cap-table'
import { CeoEquityCommandClient } from '@/components/equity/ceo-equity-command-client'

export default async function EquityInvestorsPage() {
  const data = await getCeoCapTableData()
  return <CeoEquityCommandClient data={data} initialTab="investors" />
}
