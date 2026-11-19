import { redirect } from 'next/navigation'

export default function LegacyEquityExpensesRedirect() {
  redirect('/expenses')
}
