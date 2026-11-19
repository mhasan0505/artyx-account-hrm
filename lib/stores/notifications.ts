'use client'

import { create } from 'zustand'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type ExecutiveNotificationDTO,
  type NotificationPreferenceDTO,
} from '@/lib/notifications/types'
import type { PushActivationMode } from '@/lib/notifications/push-client'

interface NotificationStoreState {
  notifications: ExecutiveNotificationDTO[]
  unreadCount: number
  popups: ExecutiveNotificationDTO[]
  preferences: NotificationPreferenceDTO
  isLoaded: boolean
  isSocketConnected: boolean
  pushPermission: NotificationPermission | 'unsupported'
  isPushSubscribed: boolean
  pushMode: PushActivationMode
  isChatboxOpen: boolean

  setInbox: (
    notifications: ExecutiveNotificationDTO[],
    unreadCount: number
  ) => void
  addIncoming: (
    notification: ExecutiveNotificationDTO,
    options?: { showPopup?: boolean }
  ) => void
  dismissPopup: (id: string) => void
  clearPopups: () => void
  markReadLocal: (id: string) => void
  markAllReadLocal: () => void
  removeLocal: (id: string) => void
  setPreferences: (prefs: NotificationPreferenceDTO) => void
  setSocketConnected: (connected: boolean) => void
  setPushState: (
    permission: NotificationPermission | 'unsupported',
    isSubscribed: boolean,
    mode?: PushActivationMode
  ) => void
  setChatboxOpen: (open: boolean) => void
}

export const useNotificationStore = create<NotificationStoreState>((set) => ({
  notifications: [],
  unreadCount: 0,
  popups: [],
  preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
  isLoaded: false,
  isSocketConnected: false,
  pushPermission: 'default',
  isPushSubscribed: false,
  pushMode: 'off',
  isChatboxOpen: false,

  setInbox: (notifications, unreadCount) =>
    set({
      notifications,
      unreadCount,
      isLoaded: true,
    }),

  addIncoming: (notification, options) =>
    set((state) => {
      const exists = state.notifications.some((n) => n.id === notification.id)
      const nextNotifications = exists
        ? state.notifications
        : [notification, ...state.notifications].slice(0, 80)

      const nextUnread =
        !exists && !notification.isRead
          ? state.unreadCount + 1
          : state.unreadCount

      const showPopup = options?.showPopup ?? true
      const alreadyInPopup = state.popups.some((p) => p.id === notification.id)
      const nextPopups =
        showPopup && !alreadyInPopup
          ? [notification, ...state.popups].slice(0, 5)
          : state.popups

      return {
        notifications: nextNotifications,
        unreadCount: nextUnread,
        popups: nextPopups,
      }
    }),

  dismissPopup: (id) =>
    set((state) => ({
      popups: state.popups.filter((p) => p.id !== id),
    })),

  clearPopups: () => set({ popups: [] }),

  markReadLocal: (id) =>
    set((state) => {
      let decremented = false
      const next = state.notifications.map((n) => {
        if (n.id === id && !n.isRead) {
          decremented = true
          return { ...n, isRead: true, readAt: new Date().toISOString() }
        }
        return n
      })
      return {
        notifications: next,
        unreadCount: decremented
          ? Math.max(0, state.unreadCount - 1)
          : state.unreadCount,
        popups: state.popups.filter((p) => p.id !== id),
      }
    }),

  markAllReadLocal: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({
        ...n,
        isRead: true,
        readAt: n.readAt || new Date().toISOString(),
      })),
      unreadCount: 0,
    })),

  removeLocal: (id) =>
    set((state) => {
      const target = state.notifications.find((n) => n.id === id)
      return {
        notifications: state.notifications.filter((n) => n.id !== id),
        unreadCount:
          target && !target.isRead
            ? Math.max(0, state.unreadCount - 1)
            : state.unreadCount,
        popups: state.popups.filter((p) => p.id !== id),
      }
    }),

  setPreferences: (preferences) => set({ preferences }),

  setSocketConnected: (isSocketConnected) => set({ isSocketConnected }),

  setPushState: (pushPermission, isPushSubscribed, mode) =>
    set({
      pushPermission,
      isPushSubscribed,
      pushMode:
        mode ??
        (isPushSubscribed
          ? 'web_push'
          : pushPermission === 'granted'
            ? 'browser_realtime'
            : 'off'),
    }),

  setChatboxOpen: (isChatboxOpen) => set({ isChatboxOpen }),
}))
