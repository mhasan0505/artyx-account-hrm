'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getSignedPdfShareUrl } from '@/lib/actions/pdf-share'
import { downloadElementAsPdf } from '@/lib/pdf/direct-pdf-download'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Printer,
  Share2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

interface PrintActionsProps {
  backHref: string
  backLabel?: string
  printLabel?: string
  challanHref?: string
  shareTitle?: string
  shareText?: string
  customerPhone?: string | null
  customerEmail?: string | null
  entityType?: 'sale' | 'purchase'
  entityId?: string
  targetId?: string
  fileName?: string
  extraActions?: React.ReactNode
  className?: string
}

export function PrintActions({
  backHref,
  backLabel = 'Back',
  printLabel = 'Print Invoice',
  challanHref,
  shareTitle = 'Invoice',
  shareText = 'Please review this invoice',
  customerPhone,
  customerEmail,
  entityType = 'sale',
  entityId,
  targetId,
  fileName,
  extraActions,
  className,
}: PrintActionsProps) {
  const [shareUrl, setShareUrl] = useState('')
  const [signedPdfUrl, setSignedPdfUrl] = useState('')
  const [isDownloading, setIsDownloading] = useState(false)

  useEffect(() => {
    setShareUrl(window.location.href)

    if (entityId) {
      getSignedPdfShareUrl(entityType, entityId, window.location.origin)
        .then(res => {
          if (res.success && res.data) {
            setSignedPdfUrl(res.data)
          } else {
            setSignedPdfUrl(window.location.href)
          }
        })
        .catch(() => setSignedPdfUrl(window.location.href))
    } else {
      setSignedPdfUrl(window.location.href)
    }
  }, [entityId, entityType])

  const whatsappMessage = useMemo(() => {
    const targetUrl = signedPdfUrl || shareUrl || (typeof window !== 'undefined' ? window.location.href : '')
    return `${shareText}\n\nView & Download PDF Invoice:\n${targetUrl}`
  }, [shareText, signedPdfUrl, shareUrl])

  // Normalize phone for WhatsApp international format (e.g. Bangladesh 01XXXXXXXXX -> 8801XXXXXXXXX)
  const normalizedPhone = useMemo(() => {
    if (!customerPhone) return ''
    const digits = customerPhone.replace(/\D/g, '')
    if (!digits) return ''
    if (digits.startsWith('01') && digits.length === 11) {
      return `88${digits}`
    }
    return digits
  }, [customerPhone])

  const whatsappHref = useMemo(() => {
    const textQuery = `text=${encodeURIComponent(whatsappMessage)}`
    return normalizedPhone
      ? `https://wa.me/${normalizedPhone}?${textQuery}`
      : `https://wa.me/?${textQuery}`
  }, [normalizedPhone, whatsappMessage])

  const emailHref = useMemo(() => {
    const to = customerEmail ? encodeURIComponent(customerEmail) : ''
    const subject = encodeURIComponent(shareTitle)
    const body = encodeURIComponent(whatsappMessage)
    return `mailto:${to}?subject=${subject}&body=${body}`
  }, [customerEmail, shareTitle, whatsappMessage])

  async function onShare() {
    if (!navigator.share) {
      toast.error('Native share is not available on this device')
      return
    }

    try {
      await navigator.share({
        title: shareTitle,
        text: shareText,
        url: signedPdfUrl || shareUrl,
      })
    } catch {
      // User cancelled
    }
  }

  async function onCopyLink() {
    try {
      const targetUrl = signedPdfUrl || shareUrl
      await navigator.clipboard.writeText(targetUrl)
      toast.success('Signed PDF link copied to clipboard')
    } catch {
      toast.error('Could not copy link')
    }
  }

  async function onDownloadPdf() {
    try {
      setIsDownloading(true)
      const container =
        (targetId ? document.getElementById(targetId) : null) ||
        document.getElementById('a4-invoice-container') ||
        document.querySelector('.sales-invoice-root') ||
        document.querySelector('.a4-invoice-container') ||
        document.body

      const saveName = (fileName || shareTitle || 'Invoice').replace(/\s+/g, '_')

      const result = await downloadElementAsPdf({
        element: container as HTMLElement,
        fileName: saveName,
        scale: 2,
      })

      if (result.success) {
        toast.success('PDF invoice downloaded!')
      } else {
        toast.error(result.error || 'Could not generate PDF')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to download PDF')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div
      className={cn(
        'mx-auto mt-6 flex flex-wrap items-center justify-center gap-2 p-1.5 sm:p-2 rounded-2xl bg-card/90 backdrop-blur-md border border-border shadow-xs no-print print:hidden max-w-fit',
        className
      )}
    >
      {/* Primary Print & PDF */}
      <Button
        onClick={() => window.print()}
        className="h-9 px-3.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 shadow-xs gap-1.5 text-xs font-medium"
      >
        <Printer className="h-4 w-4" />
        <span>{printLabel}</span>
      </Button>

      <Button
        variant="outline"
        onClick={onDownloadPdf}
        disabled={isDownloading}
        className="h-9 px-3.5 rounded-xl gap-1.5 hover:bg-muted/60 text-xs font-medium border-border"
      >
        {isDownloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        )}
        <span>Download PDF</span>
      </Button>

      {challanHref && (
        <Button
          variant="outline"
          asChild
          className="h-9 px-3.5 rounded-xl gap-1.5 hover:bg-muted/60 text-xs font-medium border-border"
        >
          <a href={challanHref}>
            <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span>Challan Copy</span>
          </a>
        </Button>
      )}

      {/* Subtle Divider */}
      <div className="hidden sm:block h-4 w-px bg-border/80 mx-0.5" />

      {/* WhatsApp Quick Share */}
      <Button
        variant="outline"
        asChild
        className="h-9 px-3.5 rounded-xl gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-medium"
      >
        <a href={whatsappHref} target="_blank" rel="noreferrer">
          <MessageSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span>WhatsApp</span>
        </a>
      </Button>

      {/* Share Dropdown (Copy Link, Email, Device Share) */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="h-9 px-3 rounded-xl gap-1.5 hover:bg-muted/60 text-xs font-medium border-border"
          >
            <Share2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span>Share</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 rounded-xl shadow-lg border-border p-1">
          <DropdownMenuItem
            onClick={onCopyLink}
            className="gap-2 py-2 cursor-pointer rounded-lg text-xs"
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Copy PDF Link</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            asChild
            className="gap-2 py-2 cursor-pointer rounded-lg text-xs"
          >
            <a href={emailHref}>
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Send via Email</span>
            </a>
          </DropdownMenuItem>
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <DropdownMenuItem
              onClick={onShare}
              className="gap-2 py-2 cursor-pointer rounded-lg text-xs"
            >
              <Share2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Device Share…</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Extra Page Actions (e.g. Edit / Correction Dropdown) */}
      {extraActions && (
        <>
          <div className="hidden sm:block h-4 w-px bg-border/80 mx-0.5" />
          {extraActions}
        </>
      )}

      {/* Subtle Divider */}
      <div className="hidden sm:block h-4 w-px bg-border/80 mx-0.5" />

      {/* Back to list */}
      <Button
        variant="ghost"
        asChild
        className="h-9 px-3 rounded-xl gap-1 text-muted-foreground hover:text-foreground text-xs font-medium"
      >
        <a href={backHref}>
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{backLabel}</span>
        </a>
      </Button>
    </div>
  )
}
