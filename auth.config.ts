import type { NextAuthConfig } from 'next-auth'

function normalizeRole(role: unknown): string {
  if (typeof role !== 'string') return ''
  return role.trim().toUpperCase().replace(/\s+/g, '_')
}

function parseSeconds(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Absolute session lifetime (hard cap). After this the user MUST re-authenticate.
// Default: 12 hours. Tune via AUTH_SESSION_MAX_AGE_SECONDS.
const SESSION_MAX_AGE = parseSeconds(
  process.env.AUTH_SESSION_MAX_AGE_SECONDS,
  60 * 60 * 12,
)

// Sliding refresh window. The JWT cookie is refreshed when accessed after this
// much inactivity, keeping the absolute cap from expiring active users.
// Default: 30 minutes. Tune via AUTH_SESSION_IDLE_TIMEOUT_SECONDS.
const SESSION_UPDATE_AGE = parseSeconds(
  process.env.AUTH_SESSION_IDLE_TIMEOUT_SECONDS,
  60 * 30,
)

export const authConfig = {
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  trustHost: true,
  basePath: '/api/auth',
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE,
    updateAge: Math.min(SESSION_UPDATE_AGE, SESSION_MAX_AGE),
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        token.role = normalizeRole((user as { role: string }).role)
        token.outletId = (user as { outletId: string }).outletId
        token.outletName = (user as { outletName: string }).outletName
        token.outletCode = (user as { outletCode: string }).outletCode
        const img = (user as { image?: string | null }).image
        token.picture =
          img && !img.startsWith('data:') && img.length < 500 ? img : null
      }

      if (trigger === 'update' && session?.user) {
        if (session.user.image !== undefined) {
          const img = session.user.image
          token.picture =
            img && !img.startsWith('data:') && img.length < 500 ? img : null
        }
        if (session.user.name) {
          token.name = session.user.name
        }
      }

      if (token.role) {
        token.role = normalizeRole(token.role)
      }

      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user = session.user ?? { name: null, email: null, image: null }
        session.user.id = token.id as string
        session.user.role = token.role as string
        session.user.outletId = token.outletId as string
        session.user.outletName = token.outletName as string
        session.user.outletCode = token.outletCode as string
        session.user.image = (token.picture as string | null) ?? null
      }
      return session
    },
  },
} satisfies NextAuthConfig
