'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  Paperclip,
  Upload,
  X,
  FileText,
  Download,
  Plus,
  Trash2,
  Check,
  Send,
  Loader2,
  Calendar,
  ExternalLink,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  PRIORITY_META,
  STATUS_COLUMNS,
  formatFileSize,
  getInitials,
  isImageAttachment,
  type ExecTaskAttachment,
  type ExecTaskChecklistItem,
  type ExecTaskInput,
  type ExecTaskMember,
  type ExecTaskPriority,
  type ExecTaskRecord,
  type ExecTaskStatus,
} from '@/lib/executive-tasks/types'
import { addExecutiveTaskComment } from '@/lib/actions/executive-tasks'
import { toast } from 'sonner'

interface ExecutiveTaskModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: ExecTaskRecord | null
  defaultStatus?: ExecTaskStatus
  members: ExecTaskMember[]
  onSave: (input: ExecTaskInput, existingId?: string) => Promise<boolean>
  onDelete?: (id: string) => Promise<void>
  onTaskUpdated?: (updated: ExecTaskRecord) => void
}

export function ExecutiveTaskModal({
  open,
  onOpenChange,
  task,
  defaultStatus = 'TODO',
  members,
  onSave,
  onDelete,
  onTaskUpdated,
}: ExecutiveTaskModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<ExecTaskStatus>(defaultStatus)
  const [priority, setPriority] = useState<ExecTaskPriority>('MEDIUM')
  const [assigneeId, setAssigneeId] = useState<string>('')
  const [dueDate, setDueDate] = useState<string>('')
  const [attachments, setAttachments] = useState<ExecTaskAttachment[]>([])
  const [checklist, setChecklist] = useState<ExecTaskChecklistItem[]>([])
  const [newCheckItem, setNewCheckItem] = useState('')

  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lightboxImage, setLightboxImage] = useState<ExecTaskAttachment | null>(null)

  // Comments
  const [commentText, setCommentText] = useState('')
  const [postingComment, setPostingComment] = useState(false)
  const [localComments, setLocalComments] = useState(task?.comments || [])

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    if (task) {
      setTitle(task.title)
      setDescription(task.description || '')
      setStatus(task.status)
      setPriority(task.priority)
      setAssigneeId(task.assignee?.id || '')
      setDueDate(task.dueDate ? task.dueDate.split('T')[0] : '')
      setAttachments(task.attachments || [])
      setChecklist(task.checklist || [])
      setLocalComments(task.comments || [])
    } else {
      setTitle('')
      setDescription('')
      setStatus(defaultStatus)
      setPriority('MEDIUM')
      setAssigneeId('')
      setDueDate('')
      setAttachments([])
      setChecklist([])
      setLocalComments([])
    }
    setNewCheckItem('')
    setCommentText('')
    setLightboxImage(null)
  }, [open, task, defaultStatus])

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (list.length === 0) return

    setUploading(true)
    try {
      const uploaded: ExecTaskAttachment[] = []
      for (const file of list) {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/executive-tasks/upload', {
          method: 'POST',
          body: fd,
        })
        const json = await res.json()
        if (!res.ok || !json.success) {
          toast.error(json.error || `Failed to upload ${file.name}`)
          continue
        }
        uploaded.push(json.attachment)
      }
      if (uploaded.length > 0) {
        setAttachments((prev) => [...prev, ...uploaded])
        toast.success(
          uploaded.length === 1
            ? `Uploaded ${uploaded[0].name}`
            : `Uploaded ${uploaded.length} files`
        )
      }
    } catch {
      toast.error('Upload failed. Please try again.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Allow pasting screenshots directly while modal is open
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      uploadFiles(files)
    }
  }

  const handleAddChecklistItem = () => {
    const text = newCheckItem.trim()
    if (!text) return
    setChecklist((prev) => [
      ...prev,
      { id: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text, done: false },
    ])
    setNewCheckItem('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Please enter a task title.')
      return
    }
    setSaving(true)
    try {
      const success = await onSave(
        {
          title: title.trim(),
          description: description.trim() || undefined,
          status,
          priority,
          assigneeId: assigneeId || null,
          dueDate: dueDate || null,
          attachments,
          checklist,
        },
        task?.id
      )
      if (success) {
        onOpenChange(false)
      }
    } finally {
      setSaving(false)
    }
  }

  const handlePostComment = async () => {
    if (!task || !commentText.trim()) return
    setPostingComment(true)
    try {
      const res = await addExecutiveTaskComment(task.id, commentText)
      if (!res.success) {
        toast.error(res.error)
        return
      }
      setLocalComments(res.data.comments)
      setCommentText('')
      onTaskUpdated?.(res.data)
    } finally {
      setPostingComment(false)
    }
  }

  const imageAttachments = attachments.filter((a) => isImageAttachment(a.type, a.name))
  const fileAttachments = attachments.filter((a) => !isImageAttachment(a.type, a.name))

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-2xl max-h-[90vh] overflow-y-auto p-6"
          onPaste={handlePaste}
        >
          <DialogHeader>
            <DialogTitle className="text-base font-semibold tracking-tight">
              {task ? 'Edit Task' : 'New Executive Task'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5 pt-1">
            {/* Title */}
            <div>
              <input
                type="text"
                required
                autoFocus={!task}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task title..."
                className="w-full bg-transparent border-b border-border pb-2 text-base font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            {/* Compact Meta Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ExecTaskStatus)}
                  className="w-full h-9 bg-background border border-input rounded-lg px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {STATUS_COLUMNS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as ExecTaskPriority)}
                  className="w-full h-9 bg-background border border-input rounded-lg px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {(Object.keys(PRIORITY_META) as ExecTaskPriority[]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_META[p].label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Assignee
                </label>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="w-full h-9 bg-background border border-input rounded-lg px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.badge})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                  Due Date
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full h-9 bg-background border border-input rounded-lg px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                Notes / Description
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Write details, links, or paste screenshots (Ctrl+V)..."
                className="w-full bg-muted/20 border border-input rounded-lg p-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              />
            </div>

            {/* File & Image Uploads */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5" />
                  Files &amp; Images ({attachments.length})
                </label>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="text-xs font-medium text-primary hover:underline cursor-pointer"
                >
                  + Upload files
                </button>
              </div>

              {/* Clean Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  if (e.dataTransfer.files?.length) {
                    uploadFiles(e.dataTransfer.files)
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`rounded-xl border border-dashed p-4 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 bg-muted/15'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={(e) => {
                    if (e.target.files?.length) uploadFiles(e.target.files)
                  }}
                  className="hidden"
                />
                {uploading ? (
                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-1">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span>Uploading…</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-1">
                    <Upload className="w-4 h-4" />
                    <span>Drop images or files here, click to browse, or paste screenshot (max 20MB)</span>
                  </div>
                )}
              </div>

              {/* Image Thumbnails */}
              {imageAttachments.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {imageAttachments.map((img) => (
                    <div
                      key={img.id}
                      className="relative group rounded-lg overflow-hidden border border-border bg-muted/30 aspect-video"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={img.name}
                        onClick={() => setLightboxImage(img)}
                        className="w-full h-full object-cover cursor-zoom-in transition-transform duration-200 group-hover:scale-105"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setAttachments((prev) => prev.filter((a) => a.id !== img.id))
                        }}
                        title="Remove image"
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Non-Image File List */}
              {fileAttachments.length > 0 && (
                <div className="space-y-1.5">
                  {fileAttachments.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-medium text-foreground truncate">{file.name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatFileSize(file.size)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <a
                          href={file.url}
                          download={file.name}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachments((prev) => prev.filter((a) => a.id !== file.id))
                          }
                          className="p-1.5 rounded-md text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                          title="Remove"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Simple Checklist */}
            <div className="space-y-2">
              <label className="block text-[11px] font-medium text-muted-foreground">
                Checklist ({checklist.filter((c) => c.done).length}/{checklist.length})
              </label>

              {checklist.length > 0 && (
                <div className="space-y-1.5">
                  {checklist.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-muted/20 border border-border/60 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setChecklist((prev) =>
                            prev.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c))
                          )
                        }
                        className="flex items-center gap-2 text-left flex-1 min-w-0 cursor-pointer"
                      >
                        <span
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                            item.done
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-input bg-background'
                          }`}
                        >
                          {item.done && <Check className="w-3 h-3" />}
                        </span>
                        <span
                          className={`truncate ${
                            item.done ? 'line-through text-muted-foreground' : 'text-foreground'
                          }`}
                        >
                          {item.text}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setChecklist((prev) => prev.filter((c) => c.id !== item.id))
                        }
                        className="text-muted-foreground hover:text-rose-500 p-1 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newCheckItem}
                  onChange={(e) => setNewCheckItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddChecklistItem()
                    }
                  }}
                  placeholder="Add checklist item..."
                  className="flex-1 h-8 bg-background border border-input rounded-lg px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAddChecklistItem}
                  className="h-8 text-xs gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </Button>
              </div>
            </div>

            {/* Executive Notes / Comments (for existing tasks) */}
            {task && (
              <div className="space-y-2.5 pt-3 border-t border-border">
                <label className="block text-[11px] font-medium text-muted-foreground">
                  Updates &amp; Comments ({localComments.length})
                </label>

                {localComments.length > 0 && (
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {localComments.map((c) => (
                      <div
                        key={c.id}
                        className="p-2.5 rounded-lg bg-muted/25 border border-border/60 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center">
                              {getInitials(c.user.name)}
                            </span>
                            <span className="font-semibold text-foreground">{c.user.name}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-medium">
                              {c.user.badge}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(c.createdAt).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="text-foreground/90 whitespace-pre-wrap pl-6">{c.content}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handlePostComment()
                      }
                    }}
                    placeholder="Write an update for CEO / COO / CMO..."
                    className="flex-1 h-9 bg-background border border-input rounded-lg px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={postingComment || !commentText.trim()}
                    onClick={handlePostComment}
                    className="h-9 gap-1.5 text-xs"
                  >
                    {postingComment ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    Post
                  </Button>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <div>
                {task && onDelete && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (confirm(`Delete task "${task.title}"?`)) {
                        await onDelete(task.id)
                        onOpenChange(false)
                      }
                    }}
                    className="text-xs text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={saving || uploading}>
                  {saving ? 'Saving...' : task ? 'Save Changes' : 'Create Task'}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Clean Image Lightbox */}
      <Dialog open={Boolean(lightboxImage)} onOpenChange={() => setLightboxImage(null)}>
        <DialogContent className="sm:max-w-3xl p-3">
          {lightboxImage && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-xs font-medium text-foreground truncate">
                  {lightboxImage.name}
                </span>
                <a
                  href={lightboxImage.url}
                  download={lightboxImage.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline mr-6"
                >
                  Open / Download <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="rounded-lg overflow-hidden bg-muted/40 flex items-center justify-center max-h-[75vh]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={lightboxImage.url}
                  alt={lightboxImage.name}
                  className="max-h-[75vh] w-auto object-contain"
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
