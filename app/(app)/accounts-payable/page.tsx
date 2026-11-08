import { redirect } from 'next/navigation'

export default function AccountsPayablePage() {
  redirect('/accounts-payable-receivable?tab=payable')
}
