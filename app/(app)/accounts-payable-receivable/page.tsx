import { getApArOverview } from '@/lib/actions/ap-ar'
import { ApArDashboard } from '@/components/ap-ar/ap-ar-dashboard'

export const dynamic = 'force-dynamic'

export default async function AccountsPayableReceivablePage() {
  const initialData = await getApArOverview()

  return <ApArDashboard initialData={initialData} />
}
