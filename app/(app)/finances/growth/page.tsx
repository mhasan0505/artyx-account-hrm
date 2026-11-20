import { getGrowthAnalyticsData } from '@/lib/actions/agency-strategy'
import { GrowthClient } from '@/components/finances/growth-client'

export default async function GrowthPage() {
  const data = await getGrowthAnalyticsData()
  return <GrowthClient data={data} />
}
