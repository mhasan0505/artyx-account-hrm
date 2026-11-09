'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function verifySecurityPin(pin: string): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { success: false, error: 'Unauthorized. Please sign in.' }
    }

    if (!pin || pin.trim().length < 4) {
      return { success: false, error: 'PIN must be at least 4 digits.' }
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, pin: true, name: true, role: true },
    })

    if (!user) {
      return { success: false, error: 'User account not found.' }
    }

    // If user has a hashed PIN stored in the database
    if (user.pin) {
      const isMatch = await bcrypt.compare(pin.trim(), user.pin)
      if (isMatch) {
        return { success: true }
      }
      return { success: false, error: 'Incorrect Security PIN.' }
    }

    // Default fallback initial PIN for accounts that haven't set a custom PIN yet
    // Standard initial agency PIN is 1234
    if (pin.trim() === '1234') {
      return { success: true }
    }

    return { success: false, error: 'Incorrect Security PIN. Default initial PIN is 1234.' }
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to verify PIN.',
    }
  }
}
