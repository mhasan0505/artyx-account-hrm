import { getCashFlowRunwayData } from '@/lib/actions/agency-cashflow'
import { CashFlowRunwayClient } from '@/components/finances/cashflow-runway-client'

export default async function CashFlowRunwayPage() {
  const data = await getCashFlowRunwayData()
  return <CashFlowRunwayClient data={data} />
}
