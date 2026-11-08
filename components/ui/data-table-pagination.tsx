'use client'

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DataTablePaginationProps {
  currentPage: number
  totalPages: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
  itemName?: string
}

export function DataTablePagination({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  itemName = 'items',
}: DataTablePaginationProps) {
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages || 1))
  const startIndex = (safeCurrentPage - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, totalItems)

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-2 py-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>
          Showing {totalItems > 0 ? startIndex + 1 : 0}–{endIndex} of {totalItems} {itemName}
        </span>
        {onPageSizeChange && (
          <>
            <span className="text-muted-foreground/40">•</span>
            <div className="flex items-center gap-1.5">
              <span>Per page:</span>
              <select
                aria-label={`Rows per page for ${itemName}`}
                value={pageSize}
                onChange={e => onPageSizeChange(Number(e.target.value))}
                className="h-7 rounded border border-input/80 bg-background px-1.5 py-0.5 text-xs text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                {pageSizeOptions.map(size => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 rounded-md pressable-subtle"
            onClick={() => onPageChange(1)}
            disabled={safeCurrentPage === 1}
            title="First page"
            aria-label="First page"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 rounded-md pressable-subtle"
            onClick={() => onPageChange(Math.max(1, safeCurrentPage - 1))}
            disabled={safeCurrentPage === 1}
            title="Previous page"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="px-2 font-medium text-foreground">
            Page {safeCurrentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 rounded-md pressable-subtle"
            onClick={() => onPageChange(Math.min(totalPages, safeCurrentPage + 1))}
            disabled={safeCurrentPage === totalPages}
            title="Next page"
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 rounded-md pressable-subtle"
            onClick={() => onPageChange(totalPages)}
            disabled={safeCurrentPage === totalPages}
            title="Last page"
            aria-label="Last page"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}
