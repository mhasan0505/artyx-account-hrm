'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  getChannelMessages,
  getChatChannels,
  sendChatMessage,
} from '@/lib/actions/team-chat'
import { useSocketChat, type ChatMessage } from '@/lib/hooks/use-socket'
import { cn } from '@/lib/utils'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronDown,
  Hash,
  Loader2,
  Maximize2,
  MessageSquare,
  Minus,
  Paperclip,
  Send,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ChatAttachmentPreview,
  formatFileSize,
} from './chat-attachment'

const QUICK_EMOJIS = ['👍', '🚀', '🔥', '🎉', '❤️', '👀', '💯']

type DraftAttachment = {
  url: string
  name: string
  type: string
  size: number
}

export function FloatingChatbox() {
  const { data: session } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [channels, setChannels] = useState<
    Array<{
      id: string
      name: string
      slug: string
      description?: string | null
    }>
  >([])
  const [activeChannelId, setActiveChannelId] = useState<string>('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)
  const [isSending, setIsSending] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [draftAttachment, setDraftAttachment] = useState<DraftAttachment | null>(
    null
  )
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    isConnected,
    onlineUserIds,
    typingUsers,
    incomingMessage,
    emitTyping,
    sendMessage: sendViaSocket,
  } = useSocketChat(activeChannelId)

  // Listen to custom header trigger event
  useEffect(() => {
    const handleOpenChat = () => {
      setIsOpen(true)
      setIsMinimized(false)
      setUnreadCount(0)
    }
    window.addEventListener('artyx-open-chat', handleOpenChat)
    return () => window.removeEventListener('artyx-open-chat', handleOpenChat)
  }, [])

  // Load initial channels
  useEffect(() => {
    if (!session?.user?.id) return
    getChatChannels()
      .then(res => {
        setChannels(res)
        if (res.length > 0 && !activeChannelId) {
          setActiveChannelId(res[0].id)
        }
      })
      .catch(err => console.error('Failed to load channels:', err))
  }, [session?.user?.id, activeChannelId])

  // Load messages when active channel changes
  useEffect(() => {
    if (!activeChannelId) return
    getChannelMessages(activeChannelId)
      .then(res => {
        setMessages(res as ChatMessage[])
        scrollToBottom()
      })
      .catch(err => console.error('Failed to load channel messages:', err))
  }, [activeChannelId])

  // Handle incoming socket message
  useEffect(() => {
    if (!incomingMessage) return
    if (incomingMessage.channelId === activeChannelId) {
      setMessages(prev => {
        // Prevent duplicate if already in state
        if (prev.some(m => m.id === incomingMessage.id)) return prev
        return [...prev, incomingMessage]
      })
      scrollToBottom()

      // Play audio notification if not own message
      if (soundEnabled && incomingMessage.user.id !== session?.user?.id) {
        playBeep()
      }
    } else {
      // Message in another channel: increment unread
      setUnreadCount(c => c + 1)
    }

    if (!isOpen) {
      setUnreadCount(c => c + 1)
    }
  }, [
    incomingMessage,
    activeChannelId,
    soundEnabled,
    session?.user?.id,
    isOpen,
  ])

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 50)
  }

  const playBeep = () => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AudioCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(587.33, ctx.currentTime) // D5
      gain.gain.setValueAtTime(0.05, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.15)
    } catch {}
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value)
    emitTyping(true)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => {
      emitTyping(false)
    }, 2000)
  }

  // Upload handler
  const handleUploadFile = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      toast.error('File size exceeds 15MB limit')
      return
    }

    setIsUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/chat/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const errJson = await res.json()
        throw new Error(errJson.error || 'Upload failed')
      }

      const data = await res.json()
      setDraftAttachment({
        url: data.url,
        name: data.name,
        type: data.type,
        size: data.size,
      })
      toast.success(`Attached ${data.name}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      toast.error(msg)
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleUploadFile(file)
    }
    // reset input
    e.target.value = ''
  }

  // Clipboard paste support (e.g. screenshot or copied file)
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile()
        if (file) {
          e.preventDefault()
          handleUploadFile(file)
          break
        }
      }
    }
  }

  // Drag and drop support
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleUploadFile(file)
    }
  }

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const text = inputText.trim()
    const attachment = draftAttachment

    if ((!text && !attachment) || !activeChannelId || isSending) return

    setIsSending(true)
    emitTyping(false)

    try {
      // 1. Try sending via real-time Socket.io
      const socketRes = await sendViaSocket(text, attachment)

      if (socketRes?.success && socketRes.message) {
        // Handled via socket event broadcast
        setInputText('')
        setDraftAttachment(null)
      } else {
        // 2. Fallback to HTTP Server Action if socket is offline or reconnecting
        const fallbackRes = await sendChatMessage({
          channelId: activeChannelId,
          content: text,
          attachmentUrl: attachment?.url,
          attachmentName: attachment?.name,
          attachmentType: attachment?.type,
          attachmentSize: attachment?.size,
        })
        setMessages(prev => [...prev, fallbackRes as ChatMessage])
        setInputText('')
        setDraftAttachment(null)
        scrollToBottom()
      }
    } catch (err) {
      console.error('Failed to send message:', err)
      toast.error('Failed to send message')
    } finally {
      setIsSending(false)
    }
  }

  const activeChannel =
    channels.find(c => c.id === activeChannelId) || channels[0]

  if (!session?.user) return null

  return (
    <div className="fixed bottom-5 right-5 z-50 print:hidden select-none">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,application/zip,application/x-zip-compressed"
      />

      {/* Floating Toggle Button (when closed or minimized) */}
      {!isOpen && (
        <motion.button
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            setIsOpen(true)
            setIsMinimized(false)
            setUnreadCount(0)
          }}
          className="relative group flex items-center gap-2.5 rounded-full bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#72e600] dark:text-black px-4 py-3 shadow-[0_8px_30px_rgba(62,112,0,0.35)] dark:shadow-[0_8px_30px_rgba(127,255,0,0.25)] transition-all cursor-pointer font-sans"
        >
          <MessageSquare className="size-5" />
          <span className="text-xs font-bold tracking-tight">Team Chat</span>

          {/* Connection status indicator */}
          <span
            className={cn(
              'size-2 rounded-full ring-2 ring-background shrink-0',
              isConnected ? 'bg-emerald-400' : 'bg-amber-400'
            )}
            title={
              isConnected ? 'Socket.io Connected' : 'Connecting to Socket...'
            }
          />

          {/* Unread badge */}
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-rose-600 text-[10px] font-black text-white shadow-md animate-bounce">
              {unreadCount}
            </span>
          )}
        </motion.button>
      )}

      {/* Expanded Chat Box Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
              height: isMinimized ? 'auto' : 560,
            }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            onDragOver={e => {
              e.preventDefault()
              setIsDraggingOver(true)
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={handleDrop}
            className={cn(
              'flex flex-col w-[360px] sm:w-[410px] rounded-2xl border bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden text-card-foreground transition-colors',
              isDraggingOver
                ? 'border-primary ring-2 ring-primary/40'
                : 'border-border/80'
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/80 bg-muted/40 px-3.5 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                {/* Channel Selector */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/70 bg-card hover:bg-muted text-foreground text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                    >
                      <Hash className="size-3.5 text-primary shrink-0" />
                      <span className="truncate max-w-[120px]">
                        {activeChannel?.name || 'general'}
                      </span>
                      <ChevronDown className="size-3 text-muted-foreground ml-0.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-52 p-1 rounded-xl shadow-xl border-border"
                  >
                    <div className="px-2 py-1 text-[10px] font-mono font-bold uppercase text-muted-foreground">
                      Agency Channels
                    </div>
                    {channels.map(c => (
                      <DropdownMenuItem
                        key={c.id}
                        onClick={() => setActiveChannelId(c.id)}
                        className={cn(
                          'cursor-pointer text-xs rounded-lg flex items-center gap-2 py-1.5',
                          activeChannelId === c.id &&
                            'bg-primary/10 text-primary font-bold'
                        )}
                      >
                        <Hash className="size-3.5" />
                        <span className="truncate">{c.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Real-time Status Badge */}
                <span
                  className={cn(
                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold font-mono',
                    isConnected
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  )}
                  title={
                    isConnected
                      ? `Socket Live (${onlineUserIds.length} online)`
                      : 'Connecting to Socket...'
                  }
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      isConnected
                        ? 'bg-emerald-500 animate-pulse'
                        : 'bg-amber-500'
                    )}
                  />
                  <span>{isConnected ? 'LIVE' : 'SYNC'}</span>
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1">
                {/* Sound Toggle */}
                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  title={soundEnabled ? 'Mute Sounds' : 'Unmute Sounds'}
                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  {soundEnabled ? (
                    <Volume2 className="size-3.5" />
                  ) : (
                    <VolumeX className="size-3.5 opacity-50" />
                  )}
                </button>

                {/* Fullscreen Page Link */}
                <Link
                  href="/team/chat"
                  title="Expand to Full Page"
                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Maximize2 className="size-3.5" />
                </Link>

                {/* Minimize Toggle */}
                <button
                  type="button"
                  onClick={() => setIsMinimized(!isMinimized)}
                  title={isMinimized ? 'Expand' : 'Minimize'}
                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <Minus className="size-3.5" />
                </button>

                {/* Close Button */}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  title="Close Chat"
                  className="p-1 rounded-lg hover:bg-rose-500/10 hover:text-rose-600 text-muted-foreground transition-colors cursor-pointer"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>

            {/* Body: Stream and Input (hidden when minimized) */}
            {!isMinimized && (
              <>
                {/* Active topic / description banner */}
                {activeChannel?.description && (
                  <div className="px-3.5 py-1.5 bg-muted/20 border-b border-border/50 text-[11px] text-muted-foreground truncate">
                    {activeChannel.description}
                  </div>
                )}

                {/* Message Feed */}
                <div className="flex-1 p-3.5 overflow-y-auto space-y-3 text-xs">
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center py-12 text-muted-foreground gap-2">
                      <div className="size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                        <MessageSquare className="size-5" />
                      </div>
                      <p className="font-semibold text-foreground">
                        Welcome to #{activeChannel?.name || 'general'}
                      </p>
                      <p className="text-[11px] max-w-[220px]">
                        Start communicating live with your agency team members
                        in real time. Drag & drop files or paste images here.
                      </p>
                    </div>
                  ) : (
                    messages.map((m, idx) => {
                      const isMe = m.user?.id === session?.user?.id
                      const timeStr = new Date(m.createdAt).toLocaleTimeString(
                        [],
                        {
                          hour: '2-digit',
                          minute: '2-digit',
                        }
                      )

                      return (
                        <div
                          key={m.id || idx}
                          className={cn(
                            'flex gap-2.5 max-w-[90%]',
                            isMe ? 'ml-auto flex-row-reverse' : ''
                          )}
                        >
                          {/* User Avatar */}
                          <div
                            className={cn(
                              'size-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 uppercase shadow-2xs overflow-hidden',
                              isMe
                                ? 'bg-[#3E7000] text-white dark:bg-[#7FFF00] dark:text-black'
                                : 'bg-muted border border-border text-foreground'
                            )}
                          >
                            {m.user?.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={m.user.image}
                                alt={m.user.name}
                                className="size-full object-cover"
                              />
                            ) : (
                              (m.user?.name || 'U').slice(0, 2)
                            )}
                          </div>

                          {/* Bubble */}
                          <div
                            className={cn(
                              'flex flex-col gap-0.5',
                              isMe ? 'items-end' : 'items-start'
                            )}
                          >
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground px-0.5">
                              <span className="font-semibold text-foreground">
                                {isMe ? 'You' : m.user?.name}
                              </span>
                              {m.user?.role && (
                                <span className="font-mono text-[9px] uppercase px-1 rounded bg-muted/60 text-muted-foreground">
                                  {m.user.role}
                                </span>
                              )}
                              <span>·</span>
                              <span>{timeStr}</span>
                            </div>

                            {/* Message text bubble (if non-empty) */}
                            {m.content && (
                              <div
                                className={cn(
                                  'rounded-2xl px-3 py-2 text-xs leading-relaxed break-words shadow-2xs',
                                  isMe
                                    ? 'bg-[#3E7000] text-white dark:bg-[#7FFF00] dark:text-black rounded-tr-xs font-medium'
                                    : 'bg-muted/70 text-foreground border border-border/80 rounded-tl-xs'
                                )}
                              >
                                {m.content}
                              </div>
                            )}

                            {/* Rich Attachment Preview */}
                            {m.attachmentUrl && (
                              <ChatAttachmentPreview
                                url={m.attachmentUrl}
                                name={m.attachmentName}
                                type={m.attachmentType}
                                size={m.attachmentSize}
                                isOutgoing={isMe}
                              />
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}

                  {/* Typing Indicator */}
                  {typingUsers.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground italic px-1">
                      <span className="flex gap-0.5">
                        <span className="size-1 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                        <span className="size-1 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                        <span className="size-1 rounded-full bg-primary animate-bounce" />
                      </span>
                      <span>
                        {typingUsers.join(', ')}{' '}
                        {typingUsers.length === 1 ? 'is' : 'are'} typing…
                      </span>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Quick Emoji Bar */}
                <div className="flex items-center gap-1 px-3 py-1 bg-muted/20 border-t border-border/40 overflow-x-auto no-scrollbar">
                  {QUICK_EMOJIS.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setInputText(prev => prev + emoji)}
                      className="p-1 hover:bg-muted rounded-md text-xs transition-transform hover:scale-125 cursor-pointer"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>

                {/* Draft Attachment Chip */}
                {draftAttachment && (
                  <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-primary/10 border-t border-primary/20 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <Paperclip className="size-3.5 text-primary shrink-0" />
                      <span className="truncate font-medium text-foreground max-w-[200px]">
                        {draftAttachment.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        ({formatFileSize(draftAttachment.size)})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDraftAttachment(null)}
                      className="p-1 hover:bg-primary/20 rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Remove attachment"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                )}

                {/* Uploading indicator */}
                {isUploading && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-t border-border text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    <span>Uploading attachment…</span>
                  </div>
                )}

                {/* Input Area */}
                <form
                  onSubmit={handleSendMessage}
                  onPaste={handlePaste}
                  className="flex items-center gap-2 p-2.5 border-t border-border/80 bg-background/80"
                >
                  {/* File attach button */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={isUploading}
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach file or screenshot"
                    className="size-8.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/80 shrink-0 cursor-pointer"
                  >
                    <Paperclip className="size-4" />
                  </Button>

                  <Input
                    value={inputText}
                    onChange={handleInputChange}
                    placeholder={`Message #${activeChannel?.name || 'channel'}…`}
                    className="h-9 text-xs bg-muted/40 border-border/80 focus-visible:ring-1 focus-visible:ring-primary rounded-xl"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={
                      (!inputText.trim() && !draftAttachment) ||
                      isSending ||
                      isUploading
                    }
                    className="size-9 rounded-xl bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#72e600] dark:text-black shadow-xs shrink-0 cursor-pointer"
                  >
                    <Send className="size-3.5" />
                  </Button>
                </form>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
