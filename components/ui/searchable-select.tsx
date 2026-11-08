'use client'

import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SearchableSelectOption {
  id: string
  name: string
  [key: string]: any
}

interface SearchableSelectProps {
  value?: string
  onValueChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  className?: string
  triggerClassName?: string
  disabled?: boolean
  showSearchThreshold?: number
}

export function SearchableSelect({
  value,
  onValueChange,
  options = [],
  placeholder = '-Select-',
  searchPlaceholder = 'Search...',
  emptyMessage = 'No options found',
  className,
  triggerClassName,
  disabled = false,
  showSearchThreshold = 5,
}: SearchableSelectProps) {
  const [searchQuery, setSearchQuery] = React.useState('')
  const [isOpen, setIsOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Reset search query when dropdown closes
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) {
      setSearchQuery('')
    }
  }

  // Focus input when dropdown opens
  React.useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const filteredOptions = React.useMemo(() => {
    if (!searchQuery.trim()) return options
    const q = searchQuery.toLowerCase().trim()
    return options.filter(opt => opt.name.toLowerCase().includes(q))
  }, [options, searchQuery])

  const showSearch = options.length >= showSearchThreshold

  return (
    <div className={cn('relative w-full', className)}>
      <Select
        value={value ?? ''}
        onValueChange={(val) => {
          onValueChange(val)
          setSearchQuery('')
        }}
        open={isOpen}
        onOpenChange={handleOpenChange}
        disabled={disabled}
      >
        <SelectTrigger className={cn('w-full', triggerClassName)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-72 min-w-48 overflow-y-auto">
          {showSearch && (
            <div className="sticky top-0 z-20 bg-popover/95 backdrop-blur-md p-1.5 border-b border-border/80 mb-1">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 size-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  ref={inputRef}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.stopPropagation()}
                  placeholder={searchPlaceholder}
                  className="h-8 pl-8 pr-7 text-xs bg-muted/40 border-border/80 focus-visible:ring-1 focus-visible:ring-ring rounded-md"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSearchQuery('')
                      inputRef.current?.focus()
                    }}
                    className="absolute right-2 p-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          <SelectGroup>
            {filteredOptions.map(option => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectGroup>

          {filteredOptions.length === 0 && (
            <div className="py-6 px-3 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-1">
              <Search className="size-5 opacity-30 mb-1" />
              <span>{emptyMessage}</span>
              {searchQuery && (
                <span className="text-[11px] text-muted-foreground/70 font-mono">
                  &ldquo;{searchQuery}&rdquo;
                </span>
              )}
            </div>
          )}
        </SelectContent>
      </Select>
    </div>
  )
}
