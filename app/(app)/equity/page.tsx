import { getCeoCapTableData } from '@/lib/actions/ceo-cap-table'
import {
  CeoEquityCommandClient,
  type CapTableTab,
} from '@/components/equity/ceo-equity-command-client'

export default async function EquityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const [data, sp] = await Promise.all([getCeoCapTableData(), searchParams])
  const rawTab = (sp?.tab || 'partners').toLowerCase()
  const initialTab: CapTableTab =
    rawTab === 'shareholders' || rawTab === 'investors' ? rawTab : 'partners'

  return <CeoEquityCommandClient data={data} initialTab={initialTab} />
}
