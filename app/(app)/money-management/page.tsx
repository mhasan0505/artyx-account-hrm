import { Metadata } from 'next';
import { requireCeoUser } from '@/lib/actions/money-management';
import { PageHeader } from '@/components/page-header';
import { MoneyManagementClient } from '@/components/money-management/MoneyManagementClient';

export const metadata: Metadata = {
  title: 'CEO Money Management | Artyx Digital Office',
  description: 'Confidential executive money management and capital ledger, exclusively for the CEO.',
};

export default async function MoneyManagementPage() {
  // Strictly enforce CEO role or CEO email access
  await requireCeoUser();

  return (
    <div className="space-y-6">
      <PageHeader
        title="CEO Money Management"
        description="Confidential capital vault, financial ledger, and strategic reserves."
        customBreadcrumbLabel="Money Management"
      />
      <MoneyManagementClient />
    </div>
  );
}
