'use client'

import { cn } from '@/lib/utils'
import {
  Download,
  Eye,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  X,
} from 'lucide-react'
import { useState } from 'react'

export function isImageAttachment(
  url?: string | null,
  type?: string | null
): boolean {
  if (!url) return false
  if (type?.startsWith('image/')) return true
  if (url.startsWith('data:image/')) return true
  return /\.(png|jpe?g|webp|gif|svg|bmp)(\?.*)?$/i.test(url)
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(type?: string | null, name?: string | null) {
  const n = (name || '').toLowerCase()
  const t = (type || '').toLowerCase()

  if (t.includes('pdf') || n.endsWith('.pdf')) {
    return <FileText className="size-5 text-rose-500 shrink-0" />
  }
  if (
    t.includes('spreadsheet') ||
    t.includes('excel') ||
    t.includes('csv') ||
    n.endsWith('.xlsx') ||
    n.endsWith('.xls') ||
    n.endsWith('.csv')
  ) {
    return <FileSpreadsheet className="size-5 text-emerald-500 shrink-0" />
  }
  if (
    t.includes('zip') ||
    t.includes('compressed') ||
    t.includes('tar') ||
    n.endsWith('.zip') ||
    n.endsWith('.rar') ||
    n.endsWith('.7z')
  ) {
    return <FileArchive className="size-5 text-amber-500 shrink-0" />
  }
  if (
    t.includes('javascript') ||
    t.includes('typescript') ||
    t.includes('json') ||
    t.includes('html') ||
    n.endsWith('.js') ||
    n.endsWith('.ts') ||
    n.endsWith('.tsx') ||
    n.endsWith('.json')
  ) {
    return <FileCode className="size-5 text-violet-500 shrink-0" />
  }
  if (t.startsWith('image/') || isImageAttachment(n, t)) {
    return <FileImage className="size-5 text-sky-500 shrink-0" />
  }
  return <File className="size-5 text-muted-foreground shrink-0" />
}

export function ChatAttachmentPreview({
  url,
  name,
  type,
  size,
  isOutgoing = false,
}: {
  url?: string | null
  name?: string | null
  type?: string | null
  size?: number | null
  isOutgoing?: boolean
}) {
  const [modalOpen, setModalOpen] = useState(false)

  if (!url) return null

  const isImg = isImageAttachment(url, type)
  const displayName = name || url.split('/').pop() || 'Attachment'

  if (isImg) {
    return (
      <>
        <div className="mt-1.5 overflow-hidden rounded-xl border border-border/80 bg-background/50 shadow-2xs group relative max-w-[280px] sm:max-w-[340px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={displayName}
            onClick={() => setModalOpen(true)}
            className="w-full max-h-64 object-cover cursor-pointer hover:scale-[1.02] transition-transform duration-200"
            loading="lazy"
          />

          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 pointer-events-none">
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                setModalOpen(true)
              }}
              className="pointer-events-auto size-8 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black transition-colors"
              title="Preview Image"
            >
              <Eye className="size-4" />
            </button>
            <a
              href={url}
              download={displayName}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="pointer-events-auto size-8 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black transition-colors"
              title="Download Image"
            >
              <Download className="size-4" />
            </a>
          </div>

          {name && (
            <div className="p-1.5 bg-black/60 text-white text-[10px] font-mono truncate px-2.5 backdrop-blur-xs flex justify-between items-center">
              <span className="truncate">{displayName}</span>
              {size ? (
                <span className="opacity-80 shrink-0 ml-1.5">
                  {formatFileSize(size)}
                </span>
              ) : null}
            </div>
          )}
        </div>

        {/* Lightbox Preview Modal */}
        {modalOpen && (
          <div
            onClick={() => setModalOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in-0"
          >
            <div
              onClick={e => e.stopPropagation()}
              className="relative max-w-4xl max-h-[90vh] flex flex-col items-center"
            >
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="absolute -top-10 right-0 size-8 rounded-full bg-white/20 text-white hover:bg-white/40 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="size-5" />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={displayName}
                className="max-h-[80vh] max-w-full rounded-xl object-contain shadow-2xl"
              />
              <div className="mt-3 flex items-center gap-3 text-white text-xs">
                <span className="font-semibold">{displayName}</span>
                {size && (
                  <span className="opacity-70 font-mono">
                    ({formatFileSize(size)})
                  </span>
                )}
                <a
                  href={url}
                  download={displayName}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[#7FFF00] hover:underline font-bold"
                >
                  <Download className="size-3.5" />
                  <span>Download</span>
                </a>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // Non-image file card
  return (
    <div
      className={cn(
        'mt-1.5 flex items-center gap-3 p-2.5 rounded-xl border max-w-xs sm:max-w-sm transition-all',
        isOutgoing
          ? 'bg-black/15 border-white/20 text-white hover:bg-black/25'
          : 'bg-muted/60 border-border/80 text-foreground hover:bg-muted'
      )}
    >
      <div className="size-9 rounded-lg bg-background/80 border border-border flex items-center justify-center shrink-0 shadow-2xs">
        {getFileIcon(type, displayName)}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate leading-tight">
          {displayName}
        </p>
        <p className="text-[10px] text-muted-foreground/80 font-mono mt-0.5">
          {formatFileSize(size) || 'Attachment'}
        </p>
      </div>

      <a
        href={url}
        download={displayName}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'size-7 rounded-lg flex items-center justify-center shrink-0 border transition-colors cursor-pointer',
          isOutgoing
            ? 'border-white/30 text-white hover:bg-white/20'
            : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted'
        )}
        title="Download file"
      >
        <Download className="size-3.5" />
      </a>
    </div>
  )
}
