"use client";

import { ColumnDef } from "@tanstack/react-table";

export type Transaction = {
  id: string;
  reference: string;
  customer: string;
  amount: number;
  paymentMethod: string;
  date: string;
};

export const columns: ColumnDef<Transaction>[] = [
  { accessorKey: "reference", header: "Reference" },
  { accessorKey: "customer", header: "Customer" },
  {
    accessorKey: "amount",
    header: "Amount",
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">
        ${row.getValue<number>("amount").toLocaleString()}
      </span>
    ),
  },
  { accessorKey: "paymentMethod", header: "Payment Method" },
  { accessorKey: "date", header: "Date" },
];
