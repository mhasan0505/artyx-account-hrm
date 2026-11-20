import { getRevenueRecognitionOverview } from '@/lib/actions/agency-accounting'
import { RevenueRecognitionClient } from '@/components/finances/revenue-recognition-client'

export default async function RevenueRecognitionPage() {
  const data = await getRevenueRecognitionOverview()
  return <RevenueRecognitionClient data={data} />
}
