'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ArrowLeft, Edit2, Plus, Search } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { toast } from 'sonner'

export type MasterEntityItem = {
  id: string
  name: string
  usageCount: number
  subtitle?: string
  departmentId?: string
}

export type DepartmentOption = {
  id: string
  name: string
}

type MasterEntityTableProps = {
  title: string
  description: string
  entityName: string
  usageLabel: string
  initialData: MasterEntityItem[]
  departmentsList?: DepartmentOption[]
  onAdd: (data: {
    name: string
    departmentId?: string
  }) => Promise<{ success: boolean; error?: string }>
  onRename: (
    id: string,
    newName: string,
    departmentId?: string
  ) => Promise<{ success: boolean; error?: string }>
}

export function MasterEntityTable({
  title,
  description,
  entityName,
  usageLabel,
  initialData,
  departmentsList,
  onAdd,
  onRename,
}: MasterEntityTableProps) {
  const [data, setData] = React.useState<MasterEntityItem[]>(initialData)
  const [search, setSearch] = React.useState('')
  const [isAddOpen, setIsAddOpen] = React.useState(false)
  const [isRenameOpen, setIsRenameOpen] = React.useState(false)
  const [selectedItem, setSelectedItem] =
    React.useState<MasterEntityItem | null>(null)

  const [formName, setFormName] = React.useState('')
  const [formDeptId, setFormDeptId] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  // Keep internal data in sync if initialData updates
  React.useEffect(() => {
    setData(initialData)
  }, [initialData])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data
    return data.filter(
      item =>
        item.name.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q))
    )
  }, [data, search])

  const handleOpenAdd = () => {
    setFormName('')
    setFormDeptId(departmentsList?.[0]?.id ?? '')
    setIsAddOpen(true)
  }

  const handleOpenRename = (item: MasterEntityItem) => {
    setSelectedItem(item)
    setFormName(item.name)
    setFormDeptId(item.departmentId ?? departmentsList?.[0]?.id ?? '')
    setIsRenameOpen(true)
  }

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formName.trim()) {
      toast.error('Name is required')
      return
    }
    if (departmentsList && !formDeptId) {
      toast.error('Department is required')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await onAdd({
        name: formName.trim(),
        departmentId: formDeptId || undefined,
      })

      if (res.success) {
        toast.success(`${entityName} created successfully`)
        setIsAddOpen(false)
        setFormName('')
        // Optimistic append / will be refreshed by revalidatePath
        const dept = departmentsList?.find(d => d.id === formDeptId)
        setData(prev => [
          ...prev,
          {
            id: 'temp-' + Date.now(),
            name: formName.trim(),
            usageCount: 0,
            subtitle: dept?.name,
            departmentId: formDeptId || undefined,
          },
        ])
      } else {
        toast.error(res.error || `Failed to create ${entityName}`)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedItem) return
    if (!formName.trim()) {
      toast.error('Name is required')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await onRename(
        selectedItem.id,
        formName.trim(),
        formDeptId || undefined
      )

      if (res.success) {
        toast.success(`${entityName} renamed successfully`)
        setIsRenameOpen(false)
        const dept = departmentsList?.find(d => d.id === formDeptId)
        setData(prev =>
          prev.map(i =>
            i.id === selectedItem.id
              ? {
                  ...i,
                  name: formName.trim(),
                  subtitle: dept ? dept.name : i.subtitle,
                  departmentId: formDeptId || i.departmentId,
                }
              : i
          )
        )
      } else {
        toast.error(res.error || `Failed to rename ${entityName}`)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="-ml-2 h-8 text-muted-foreground hover:text-foreground"
            >
              <Link href="/master-setup">
                <ArrowLeft className="size-4 mr-1" />
                Master Setup
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        <Button
          onClick={handleOpenAdd}
          className="gap-1.5 shadow-xs cursor-pointer"
        >
          <Plus className="size-4" />
          <span>Add {entityName}</span>
        </Button>
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder={`Search ${title.toLowerCase()}...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          Showing {filtered.length} of {data.length}
        </span>
      </div>

      {/* Entity Table */}
      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="font-semibold text-foreground">
                Name
              </TableHead>
              {departmentsList && (
                <TableHead className="font-semibold text-foreground">
                  Department
                </TableHead>
              )}
              <TableHead className="font-semibold text-foreground">
                Usage
              </TableHead>
              <TableHead className="text-right font-semibold text-foreground w-28">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={departmentsList ? 4 : 3}
                  className="h-32 text-center text-sm text-muted-foreground"
                >
                  {search
                    ? `No matching ${entityName.toLowerCase()} found for "${search}".`
                    : `No ${title.toLowerCase()} configured yet. Click "Add ${entityName}" to create one.`}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(item => (
                <TableRow key={item.id} className="hover:bg-muted/40">
                  <TableCell className="font-medium text-foreground">
                    {item.name}
                  </TableCell>
                  {departmentsList && (
                    <TableCell className="text-sm text-muted-foreground">
                      {item.subtitle || '—'}
                    </TableCell>
                  )}
                  <TableCell>
                    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {item.usageCount}{' '}
                      {item.usageCount === 1
                        ? usageLabel.replace(/s$/, '')
                        : usageLabel}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenRename(item)}
                      className="h-8 gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <Edit2 className="size-3.5" />
                      <span>Rename</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleAddSubmit}>
            <DialogHeader>
              <DialogTitle>Add New {entityName}</DialogTitle>
              <DialogDescription>
                Define a new {entityName.toLowerCase()} for use across the POS
                catalog.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="add-name">Name</Label>
                <Input
                  id="add-name"
                  placeholder={`e.g. ${
                    entityName === 'RAM'
                      ? '16GB DDR5'
                      : entityName === 'Storage'
                      ? '1TB NVMe'
                      : entityName === 'Processor'
                      ? 'Intel Core i7'
                      : entityName
                  }`}
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {departmentsList && (
                <div className="space-y-1.5">
                  <Label htmlFor="add-dept">Department</Label>
                  <Select
                    value={formDeptId}
                    onValueChange={v => setFormDeptId(v || '')}
                  >
                    <SelectTrigger id="add-dept">
                      <SelectValue placeholder="Select Department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departmentsList.map(dept => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : `Create ${entityName}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleRenameSubmit}>
            <DialogHeader>
              <DialogTitle>Rename {entityName}</DialogTitle>
              <DialogDescription>
                Update the name of this {entityName.toLowerCase()}. Existing
                linked records will reflect the new name.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="rename-name">Name</Label>
                <Input
                  id="rename-name"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {departmentsList && (
                <div className="space-y-1.5">
                  <Label htmlFor="rename-dept">Department</Label>
                  <Select
                    value={formDeptId}
                    onValueChange={v => setFormDeptId(v || '')}
                  >
                    <SelectTrigger id="rename-dept">
                      <SelectValue placeholder="Select Department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departmentsList.map(dept => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsRenameOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
