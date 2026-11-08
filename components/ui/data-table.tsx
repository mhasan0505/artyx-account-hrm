'use client'

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  OnChangeFn,
  Row,
  RowSelectionState,
  SortingState,
  useReactTable,
} from '@tanstack/react-table'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { useEffect, useRef, useState } from 'react'

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  /** Optional ID of a row to highlight and scroll into view. */
  highlightId?: string
  /** Name of the property on each data item that holds the unique ID (e.g. "id").
   *  Used together with highlightId to find the row to highlight. */
  idField?: string
  /** Whether data is currently loading */
  isLoading?: boolean
  /** Number of skeleton rows to display while loading (defaults to 5) */
  loadingRowsCount?: number
  /** Custom empty state title */
  emptyTitle?: string
  /** Custom empty state description */
  emptyDescription?: string
  /** Sorting state if controlled externally */
  sorting?: SortingState
  /** Callback when sorting changes */
  onSortingChange?: OnChangeFn<SortingState>
  /** Row selection state if controlled externally */
  rowSelection?: RowSelectionState
  /** Callback when row selection changes */
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  /** Predicate or boolean for row selection */
  enableRowSelection?: boolean | ((row: Row<TData>) => boolean)
  /** Render function for custom bulk actions when rows are selected */
  renderBulkActions?: (selectedRows: TData[], clearSelection: () => void) => React.ReactNode
}

export function DataTable<TData, TValue>({
  columns,
  data,
  highlightId,
  idField,
  isLoading = false,
  loadingRowsCount = 5,
  emptyTitle,
  emptyDescription,
  sorting,
  onSortingChange,
  rowSelection,
  onRowSelectionChange,
  enableRowSelection,
  renderBulkActions,
}: DataTableProps<TData, TValue>) {
  const highlightRef = useRef<HTMLTableRowElement>(null)

  const [internalSorting, setInternalSorting] = useState<SortingState>([])
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>({})

  const activeSorting = sorting !== undefined ? sorting : internalSorting
  const handleSortingChange: OnChangeFn<SortingState> = onSortingChange ?? setInternalSorting

  const activeRowSelection = rowSelection !== undefined ? rowSelection : internalRowSelection
  const handleRowSelectionChange: OnChangeFn<RowSelectionState> =
    onRowSelectionChange ?? setInternalRowSelection

  const table = useReactTable<TData>({
    data,
    columns,
    state: {
      sorting: activeSorting,
      rowSelection: activeRowSelection,
    },
    onSortingChange: handleSortingChange,
    onRowSelectionChange: handleRowSelectionChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: enableRowSelection ?? true,
  })

  // Scroll highlighted row into view after mount
  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }, [highlightId])

  const selectedRows = table.getSelectedRowModel().rows.map(r => r.original)
  const selectedCount = selectedRows.length

  return (
    <div className="space-y-2">
      {/* Floating or pinned Bulk Action Bar */}
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg text-sm text-foreground animate-in fade-in-50 slide-in-from-top-1">
          <div className="flex items-center gap-2.5 font-medium">
            <span className="inline-flex items-center justify-center size-5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
              {selectedCount}
            </span>
            <span className="text-xs sm:text-sm">
              {selectedCount === 1 ? '1 item selected' : `${selectedCount} items selected`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground pressable-subtle"
              onClick={() => table.resetRowSelection()}
            >
              Clear
            </Button>
          </div>
          {renderBulkActions && (
            <div className="flex items-center gap-2">
              {renderBulkActions(selectedRows, () => table.resetRowSelection())}
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map(headerGroup => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: loadingRowsCount }).map((_, rIdx) => (
                <TableRow key={`loading-row-${rIdx}`}>
                  {columns.map((_, cIdx) => (
                    <TableCell key={`loading-cell-${rIdx}-${cIdx}`} className="py-3">
                      <Skeleton className="h-4 w-full rounded" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map(row => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rowId = idField ? (row.original as any)[idField] : row.id
                const isHighlighted = highlightId === rowId
                return (
                  <TableRow
                    key={row.id}
                    ref={isHighlighted ? highlightRef : undefined}
                    data-state={row.getIsSelected() && 'selected'}
                    className={
                      isHighlighted
                        ? 'bg-yellow-100 dark:bg-yellow-900/30 transition-colors'
                        : undefined
                    }
                  >
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-6">
                  <EmptyState
                    title={emptyTitle || 'No results found'}
                    description={
                      emptyDescription ||
                      'There are no records matching your current filter or search criteria.'
                    }
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
