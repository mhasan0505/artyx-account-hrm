import { getValuationReadinessData } from '@/lib/actions/agency-strategy'
import { ValuationClient } from '@/components/finances/valuation-client'

export default async function ValuationPage() {
  const data = await getValuationReadinessData()
  return <ValuationClient data={data} />
}
