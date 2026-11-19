import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockEmit = vi.fn()
const mockTo = vi.fn(() => ({ emit: mockEmit }))
const mockSendNotification = vi.fn()

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  userNotification: {
    create: vi.fn(),
  },
  pushSubscription: {
    delete: vi.fn(),
  },
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/server/socket', () => ({
  getSocketIo: () => ({ to: mockTo }),
}))
vi.mock('@/lib/notifications/vapid', () => ({
  getWebPushAsync: async () => ({ sendNotification: mockSendNotification }),
}))
vi.mock('@/lib/auth/executive-server', () => ({
  getExecutiveMembers: vi.fn(async () => [
    { id: 'ceo-1', name: 'Arafat', email: 'ceo@artyx.com', image: null, badge: 'CEO' },
    { id: 'coo-1', name: 'Nabil', email: 'coo@artyx.com', image: null, badge: 'COO' },
    { id: 'cmo-1', name: 'Sadia', email: 'cmo@artyx.com', image: null, badge: 'CMO' },
  ]),
  resolveUserCustomRole: vi.fn(async (id: string) =>
    id === 'ceo-1' ? 'CEO' : id === 'coo-1' ? 'COO' : 'CMO'
  ),
}))

describe('dispatchNotification & notifyExecutives', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'ceo-1',
      name: 'Arafat',
      role: 'ADMIN',
      image: null,
    })
    mockPrisma.userNotification.create.mockImplementation(async ({ data }: any) => ({
      id: `notif-${data.recipientId}`,
      ...data,
      isRead: false,
      readAt: null,
      createdAt: new Date('2026-11-20T00:00:00.000Z'),
    }))
    mockSendNotification.mockResolvedValue({ statusCode: 201 })
  })

  it('excludes acting executive, persists per recipient, emits socket event, and sends Web Push', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: 'coo-1',
        notificationPreference: null,
        pushSubscriptions: [
          { id: 'sub-1', endpoint: 'https://push.example/coo', p256dh: 'k1', auth: 'a1' },
        ],
      },
      {
        id: 'cmo-1',
        notificationPreference: {
          desktopPushEnabled: true,
          inAppPopupEnabled: true,
          soundEnabled: true,
          notifyWhenActive: true,
          mutedCategories: [],
          dndEnabled: false,
        },
        pushSubscriptions: [],
      },
    ])

    const { notifyExecutives } = await import('@/lib/notifications/executive-notifier')

    const res = await notifyExecutives({
      actorId: 'ceo-1',
      category: 'EXECUTIVE_TASK',
      priority: 'HIGH',
      eventKey: 'exec_task.created',
      title: 'Q4 Launch Plan',
      body: 'Arafat created a high-priority task.',
      url: '/executive-tasks',
    })

    expect(res.sentNotifications).toBe(2)
    expect(res.sentWebPush).toBe(1)
    expect(res.recipientIds).toEqual(['coo-1', 'cmo-1'])
    expect(res.recipientIds).not.toContain('ceo-1')

    expect(mockTo).toHaveBeenCalledWith('user:coo-1')
    expect(mockTo).toHaveBeenCalledWith('user:cmo-1')
    expect(mockEmit).toHaveBeenCalledWith(
      'executive_notification',
      expect.objectContaining({
        id: 'notif-coo-1',
        actorBadge: 'CEO',
        title: 'Q4 Launch Plan',
        tag: 'artyx-notif-notif-coo-1',
      })
    )
    expect(mockSendNotification).toHaveBeenCalledTimes(1)
  })

  it('respects muted categories for NORMAL alerts but delivers URGENT alerts and prunes 410 subscriptions', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: 'coo-1',
        notificationPreference: {
          desktopPushEnabled: true,
          inAppPopupEnabled: true,
          soundEnabled: true,
          notifyWhenActive: true,
          mutedCategories: ['EXPENSE'],
          dndEnabled: false,
        },
        pushSubscriptions: [
          { id: 'sub-stale', endpoint: 'https://push.example/stale', p256dh: 'k', auth: 'a' },
        ],
      },
    ])

    mockSendNotification.mockRejectedValueOnce({ statusCode: 410 })
    mockPrisma.pushSubscription.delete.mockResolvedValue({})

    const { dispatchNotification } = await import('@/lib/notifications/executive-notifier')

    // 1. Muted NORMAL alert should be skipped
    const normalRes = await dispatchNotification({
      actorId: 'ceo-1',
      recipientIds: ['coo-1'],
      category: 'EXPENSE',
      priority: 'NORMAL',
      eventKey: 'expense.created',
      title: 'Office Supplies',
      body: '৳1,200 expense',
    })
    expect(normalRes.sentNotifications).toBe(0)

    // 2. URGENT alert breaks through mute and prunes 410 subscription
    const urgentRes = await dispatchNotification({
      actorId: 'ceo-1',
      recipientIds: ['coo-1'],
      category: 'EXPENSE',
      priority: 'URGENT',
      eventKey: 'expense.urgent',
      title: 'Urgent Approval Required',
      body: '৳250,000 vendor transfer',
    })
    expect(urgentRes.sentNotifications).toBe(1)
    expect(mockPrisma.pushSubscription.delete).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.example/stale' },
    })
  })
})
