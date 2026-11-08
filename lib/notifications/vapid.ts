import webpush from 'web-push'

let isConfigured = false

export function getVapidConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@artyxdigital.com'

  if (!publicKey || !privateKey) {
    return {
      isReady: false,
      publicKey: publicKey || '',
      privateKey: privateKey || '',
      subject,
      error: 'VAPID keys are missing. Please configure NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.',
    }
  }

  if (!isConfigured) {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    isConfigured = true
  }

  return {
    isReady: true,
    publicKey,
    privateKey,
    subject,
    error: null,
  }
}

export function getWebPush() {
  const config = getVapidConfig()
  if (!config.isReady) {
    throw new Error(config.error || 'VAPID is not properly configured')
  }
  return webpush
}
