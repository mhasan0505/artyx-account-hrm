import { getGuardrailsDashboardData } from '@/lib/actions/agency-cashflow'
import { GuardrailsClient } from '@/components/finances/guardrails-client'

export default async function GuardrailsPage() {
  const data = await getGuardrailsDashboardData()
  return <GuardrailsClient data={data} />
}
