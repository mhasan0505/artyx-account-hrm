"use client"

import { ColumnDef } from "@tanstack/react-table"

export type Expense = {
  id: string
  description: string
  category: string
  amount: number
  by: string
  date: string
}

export const columns: ColumnDef<Expense>[] = [
  { accessorKey: "description", header: "Description" },
  { accessorKey: "category", header: "Category" },
  {
    accessorKey: "amount",
    header: "Amount",
    cell: ({ row }) => (
      <span className="font-mono tabular-nums text-red-600">
        -${row.getValue<number>("amount").toLocaleString()}
      </span>
    ),
  },
  { accessorKey: "by", header: "By" },
  { accessorKey: "date", header: "Date" },
]
