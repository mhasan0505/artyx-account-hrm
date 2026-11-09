'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  createChatChannel,
  getChannelMessages,
  sendChatMessage,
} from '@/lib/actions/team-chat'
import { useSocketChat, type ChatMessage } from '@/lib/hooks/use-socket'
import { cn } from '@/lib/utils'
import {
  Hash,
  Info,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useSession } from 'next-auth/react'
import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ChatAttachmentPreview,
  formatFileSize,
} from './chat-attachment'

const QUICK_EMOJIS = [
  '👍',
  '🚀',
  '🔥',
  '🎉',
  '❤️',
  '👀',
  '💯',
  '✨',
  '🙌',
  '💡',
]

type Channel = {
  id: string
  name: string
  slug: string
  description?: string | null
  _count?: { messages: number }
}

type TeamUser = {
  id: string
  name: string
  email: string
  role: string
  image?: string | null
}

type DraftAttachment = {
  url: string
  name: string
  type: string
  size: number
}

export function TeamChatView({
  initialChannels = [],
  teamUsers = [],
}: {
  initialChannels: Channel[]
  teamUsers: TeamUser[]
}) {
  const { data: session } = useSession()
  const [channels, setChannels] = useState<Channel[]>(initialChannels)
  const [activeChannelId, setActiveChannelId] = useState<string>(
    initialChannels[0]?.id || ''
  )
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [showChannelModal, setShowChannelModal] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelDesc, setNewChannelDesc] = useState('')
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [showInfoSidebar, setShowInfoSidebar] = useState(true)
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

  // Load messages on channel change
  useEffect(() => {
    if (!activeChannelId) return
    getChannelMessages(activeChannelId)
      .then(res => {
        setMessages(res as ChatMessage[])
        scrollToBottom()
      })
      .catch(err => console.error('Failed to load messages:', err))
  }, [activeChannelId])

  // Incoming message handling
  useEffect(() => {
    if (!incomingMessage) return
    if (incomingMessage.channelId === activeChannelId) {
      setMessages(prev => {
        if (prev.some(m => m.id === incomingMessage.id)) return prev
        return [...prev, incomingMessage]
      })
      scrollToBottom()

      if (soundEnabled && incomingMessage.user.id !== session?.user?.id) {
        playBeep()
      }
    }
  }, [incomingMessage, activeChannelId, soundEnabled, session?.user?.id])

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 60)
  }

  const playBeep = () => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      const ctx = new AudioCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(659.25, ctx.currentTime) // E5
      gain.gain.setValueAtTime(0.04, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.15)
    } catch {}
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value)
    emitTyping(true)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => {
      emitTyping(false)
    }, 2000)
  }

  // File upload handler
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
    e.target.value = ''
  }

  // Clipboard paste support
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

  // Drag & drop support
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleUploadFile(file)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleSendMessage = async () => {
    const text = inputText.trim()
    const attachment = draftAttachment
    if ((!text && !attachment) || !activeChannelId || isSending) return

    setIsSending(true)
    emitTyping(false)

    try {
      // 1. Try real-time Socket.io broadcast
      const socketRes = await sendViaSocket(text, attachment)

      if (socketRes?.success && socketRes.message) {
        setInputText('')
        setDraftAttachment(null)
      } else {
        // 2. Fallback to HTTP Action
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
    } catch (err: unknown) {
      toast.error('Failed to deliver message')
    } finally {
      setIsSending(false)
    }
  }

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newChannelName.trim()) return

    setCreatingChannel(true)
    try {
      const created = await createChatChannel({
        name: newChannelName,
        description: newChannelDesc,
      })
      toast.success(`Channel #${created.name} created!`)
      setChannels(prev => [...prev, created])
      setActiveChannelId(created.id)
      setNewChannelName('')
      setNewChannelDesc('')
      setShowChannelModal(false)
    } catch (err: any) {
      toast.error(err.message || 'Failed to create channel')
    } finally {
      setCreatingChannel(false)
    }
  }

  const activeChannel =
    channels.find(c => c.id === activeChannelId) || channels[0]

  // Filter messages by search query if present
  const filteredMessages = searchQuery.trim()
    ? messages.filter(
        m =>
          m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.user.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : messages

  return (
    <div
      onDragOver={e => {
        e.preventDefault()
        setIsDraggingOver(true)
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
      className={cn(
        'flex h-[calc(100vh-5rem)] w-full rounded-2xl border bg-card overflow-hidden shadow-xs transition-colors',
        isDraggingOver
          ? 'border-primary ring-2 ring-primary/40'
          : 'border-border/80'
      )}
    >
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,application/zip,application/x-zip-compressed"
      />

      {/* ── Left Sidebar: Channels & Team Members ── */}
      <div className="w-64 sm:w-72 border-r border-border/80 bg-muted/20 flex flex-col shrink-0">
        {/* Workspace Title & Status */}
        <div className="p-4 border-b border-border/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center font-bold">
              <MessageSquare className="size-4" />
            </div>
            <div>
              <h2 className="font-extrabold text-xs tracking-tight text-foreground">
                Artyx Team Hub
              </h2>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    isConnected ? 'bg-emerald-500' : 'bg-amber-500'
                  )}
                />
                <span className="font-mono">
                  {isConnected ? 'Socket.io Online' : 'Connecting...'}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title={soundEnabled ? 'Mute Sounds' : 'Unmute Sounds'}
          >
            {soundEnabled ? (
              <Volume2 className="size-3.5" />
            ) : (
              <VolumeX className="size-3.5 opacity-50" />
            )}
          </button>
        </div>

        {/* Channels List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          <div>
            <div className="flex items-center justify-between px-2 mb-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
              <span>Channels</span>
              <button
                type="button"
                onClick={() => setShowChannelModal(true)}
                className="hover:text-primary transition-colors cursor-pointer flex items-center gap-0.5"
                title="Create Channel"
              >
                <Plus className="size-3" />
                <span>New</span>
              </button>
            </div>
            <div className="space-y-0.5">
              {channels.map(c => {
                const isActive = c.id === activeChannelId
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveChannelId(c.id)}
                    className={cn(
                      'flex items-center justify-between w-full px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left',
                      isActive
                        ? 'bg-[#3E7000] text-white dark:bg-[#7FFF00] dark:text-black shadow-2xs'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Hash className="size-3.5 shrink-0 opacity-80" />
                      <span className="truncate">{c.name}</span>
                    </div>
                    {c._count?.messages ? (
                      <span
                        className={cn(
                          'text-[10px] font-mono px-1.5 py-0.2 rounded-full',
                          isActive
                            ? 'bg-black/20 text-white dark:text-black'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {c._count.messages}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Online Team Members Section */}
          <div>
            <div className="px-2 mb-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
              <span>Direct Coworkers ({onlineUserIds.length} Active)</span>
            </div>
            <div className="space-y-1">
              {teamUsers.map(user => {
                const isOnline =
                  onlineUserIds.includes(user.id) ||
                  user.id === session?.user?.id
                return (
                  <div
                    key={user.id}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs hover:bg-muted/50 transition-colors"
                  >
                    <div className="relative">
                      <div className="size-6 rounded-full bg-muted border border-border flex items-center justify-center text-[10px] font-bold text-foreground overflow-hidden">
                        {user.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={user.image}
                            alt={user.name}
                            className="size-full object-cover"
                          />
                        ) : (
                          user.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <span
                        className={cn(
                          'absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-card',
                          isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-foreground text-xs leading-none">
                        {user.name}
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground capitalize mt-0.5">
                        {user.role}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Chat Area ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/50">
        {/* Channel Header */}
        <div className="h-14 border-b border-border/80 px-4 flex items-center justify-between bg-card/60 backdrop-blur-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-1 font-bold text-sm text-foreground">
              <Hash className="size-4 text-primary" />
              <span>{activeChannel?.name || 'general'}</span>
            </div>
            {activeChannel?.description && (
              <span className="hidden md:inline text-xs text-muted-foreground truncate max-w-md border-l border-border pl-2.5">
                {activeChannel.description}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Search messages */}
            <div className="relative w-40 sm:w-56 hidden sm:block">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search channel…"
                className="h-8 pl-8 text-xs bg-muted/40 border-border/80 rounded-xl"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowInfoSidebar(!showInfoSidebar)}
              className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Toggle Channel Details"
            >
              <Info className="size-4" />
            </button>
          </div>
        </div>

        {/* Message Thread */}
        <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
          {filteredMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-20 text-muted-foreground gap-2">
              <div className="size-12 rounded-2xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center">
                <Hash className="size-6" />
              </div>
              <p className="text-base font-bold text-foreground">
                Welcome to #{activeChannel?.name}!
              </p>
              <p className="text-xs max-w-sm">
                This is the start of the #{activeChannel?.name} channel. Send a
                message, paste images, or drag & drop files to collaborate with your team.
              </p>
            </div>
          ) : (
            filteredMessages.map((m, idx) => {
              const isMe = m.user?.id === session?.user?.id
              const timeStr = new Date(m.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
              const dateStr = new Date(m.createdAt).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
              })

              return (
                <div
                  key={m.id || idx}
                  className={cn(
                    'flex gap-3 max-w-[85%] group',
                    isMe ? 'ml-auto flex-row-reverse' : ''
                  )}
                >
                  {/* User Avatar */}
                  <div
                    className={cn(
                      'size-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 uppercase shadow-2xs overflow-hidden',
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
                      (m.user?.name || 'U').slice(0, 2).toUpperCase()
                    )}
                  </div>

                  {/* Bubble Content */}
                  <div
                    className={cn(
                      'flex flex-col gap-1',
                      isMe ? 'items-end' : 'items-start'
                    )}
                  >
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground px-1">
                      <span className="font-bold text-foreground">
                        {isMe ? 'You' : m.user?.name}
                      </span>
                      {m.user?.role && (
                        <span className="font-mono text-[9px] uppercase px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                          {m.user.role}
                        </span>
                      )}
                      <span>·</span>
                      <span>
                        {dateStr} at {timeStr}
                      </span>
                    </div>

                    {/* Text Message Bubble */}
                    {m.content && (
                      <div
                        className={cn(
                          'rounded-2xl px-4 py-2.5 text-xs leading-relaxed break-words shadow-2xs',
                          isMe
                            ? 'bg-[#3E7000] text-white dark:bg-[#7FFF00] dark:text-black rounded-tr-xs font-medium'
                            : 'bg-card border border-border/90 text-foreground rounded-tl-xs'
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
            <div className="flex items-center gap-2 text-xs text-muted-foreground italic px-2">
              <span className="flex gap-1">
                <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                <span className="size-1.5 rounded-full bg-primary animate-bounce" />
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
        <div className="flex items-center gap-1.5 px-4 py-1.5 bg-muted/20 border-t border-border/40 overflow-x-auto no-scrollbar">
          <span className="text-[11px] font-mono text-muted-foreground mr-1">
            Quick:
          </span>
          {QUICK_EMOJIS.map(emoji => (
            <button
              key={emoji}
              type="button"
              onClick={() => setInputText(prev => prev + emoji)}
              className="px-1.5 py-0.5 hover:bg-muted rounded-md text-xs transition-transform hover:scale-125 cursor-pointer"
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* Message Input Box */}
        <div className="p-3 sm:p-4 border-t border-border/80 bg-card">
          {/* Draft attachment preview chip */}
          {draftAttachment && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 mb-2 bg-primary/10 border border-primary/20 rounded-xl text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Paperclip className="size-4 text-primary shrink-0" />
                <span className="truncate font-semibold text-foreground">
                  {draftAttachment.name}
                </span>
                <span className="text-[11px] text-muted-foreground font-mono">
                  ({formatFileSize(draftAttachment.size)})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDraftAttachment(null)}
                className="p-1 hover:bg-primary/20 rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
                title="Remove attachment"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {isUploading && (
            <div className="flex items-center gap-2 px-3 py-1.5 mb-2 bg-muted/50 rounded-xl text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-primary" />
              <span>Uploading attachment…</span>
            </div>
          )}

          <div className="relative rounded-2xl border border-border bg-background/90 p-2 shadow-2xs focus-within:ring-1 focus-within:ring-primary focus-within:border-primary/50 transition-all">
            <Textarea
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={`Message #${activeChannel?.name || 'channel'}… (Press Enter to send, Shift+Enter for new line)`}
              className="w-full resize-none border-0 bg-transparent p-1.5 text-xs focus-visible:ring-0 min-h-[50px] max-h-36"
              rows={2}
            />

            <div className="flex items-center justify-between pt-2 border-t border-border/40 mt-1">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach file or screenshot"
                  className="size-7.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 shrink-0 cursor-pointer"
                >
                  <Paperclip className="size-4" />
                </Button>

                <span className="text-[10px] font-mono text-muted-foreground/70 hidden sm:inline">
                  ⚡ Socket.io active · Drag files or paste images
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline">
                  Enter ↵ to send
                </span>
                <Button
                  type="button"
                  onClick={() => handleSendMessage()}
                  disabled={
                    (!inputText.trim() && !draftAttachment) ||
                    isSending ||
                    isUploading
                  }
                  size="sm"
                  className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#72e600] dark:text-black font-bold rounded-xl h-8 px-3.5 gap-1.5 cursor-pointer shadow-xs"
                >
                  <Send className="size-3.5" />
                  <span>Send</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: Channel Details Panel ── */}
      {showInfoSidebar && (
        <div className="w-64 border-l border-border/80 bg-muted/10 p-4 space-y-4 shrink-0 hidden lg:block text-xs">
          <div>
            <h3 className="font-bold text-foreground text-sm flex items-center gap-1.5">
              <Hash className="size-4 text-primary" />
              <span>{activeChannel?.name}</span>
            </h3>
            <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
              {activeChannel?.description || 'No description provided.'}
            </p>
          </div>

          <div className="border-t border-border/80 pt-3 space-y-2">
            <div className="flex justify-between items-center text-muted-foreground">
              <span>Channel Slug:</span>
              <span className="font-mono font-semibold text-foreground">
                #{activeChannel?.slug}
              </span>
            </div>
            <div className="flex justify-between items-center text-muted-foreground">
              <span>Socket Status:</span>
              <span
                className={
                  isConnected ? 'text-emerald-500 font-bold' : 'text-amber-500'
                }
              >
                {isConnected ? 'Connected' : 'Connecting'}
              </span>
            </div>
            <div className="flex justify-between items-center text-muted-foreground">
              <span>Socket Port:</span>
              <span className="font-mono text-foreground font-semibold">
                3001
              </span>
            </div>
          </div>

          <div className="border-t border-border/80 pt-3">
            <h4 className="font-bold text-foreground text-xs mb-2">
              Team Presence
            </h4>
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {teamUsers.map(user => {
                const isOnline =
                  onlineUserIds.includes(user.id) ||
                  user.id === session?.user?.id
                return (
                  <div key={user.id} className="flex items-center gap-2">
                    <span
                      className={cn(
                        'size-2 rounded-full shrink-0',
                        isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                      )}
                    />
                    <span className="truncate text-foreground font-medium">
                      {user.name}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Create New Channel ── */}
      <Dialog open={showChannelModal} onOpenChange={setShowChannelModal}>
        <DialogContent className="sm:max-w-md bg-card border-border rounded-2xl">
          <form onSubmit={handleCreateChannel}>
            <DialogHeader>
              <DialogTitle className="text-base font-extrabold text-foreground flex items-center gap-2">
                <Hash className="size-4 text-primary" />
                <span>Create Channel</span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3.5 py-4 text-xs">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Channel Name
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">
                    #
                  </span>
                  <Input
                    required
                    value={newChannelName}
                    onChange={e => setNewChannelName(e.target.value)}
                    placeholder="e.g. project-apollo or client-review"
                    className="pl-7 bg-muted/40 border-border text-xs rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Description (Optional)
                </Label>
                <Input
                  value={newChannelDesc}
                  onChange={e => setNewChannelDesc(e.target.value)}
                  placeholder="What is this channel about?"
                  className="bg-muted/40 border-border text-xs rounded-xl"
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowChannelModal(false)}
                className="rounded-xl text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!newChannelName.trim() || creatingChannel}
                className="bg-[#3E7000] hover:bg-[#346000] text-white dark:bg-[#7FFF00] dark:hover:bg-[#72e600] dark:text-black font-semibold rounded-xl text-xs"
              >
                {creatingChannel ? 'Creating…' : 'Create Channel'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
