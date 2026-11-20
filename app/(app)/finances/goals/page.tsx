import { getGoalsAndPodsData } from '@/lib/actions/agency-strategy'
import { GoalsClient } from '@/components/finances/goals-client'

export default async function GoalsPage() {
  const data = await getGoalsAndPodsData()
  return <GoalsClient data={data} />
}
