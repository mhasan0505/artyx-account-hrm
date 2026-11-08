/**
 * Centralized brand assets and default metadata for Artyx Digital PDF reports and print views.
 */

export const DEFAULT_COMPANY_NAME = 'Artyx Digital'

export const DEFAULT_COMPANY_ADDRESS =
  'Level 4, House 12, Road 4, Sector 3, Uttara, Dhaka-1230, Bangladesh'

export const DEFAULT_COMPANY_PHONE = '+880 1800-000000'

export const DEFAULT_COMPANY_EMAIL = 'admin@artyxdigital.com'

/**
 * Official Artyx Digital Brand Logo.
 * Encoded as Base64 data URL for instant, zero-latency, zero-CORS embedding
 * in jsPDF across both client browser, SSR, and test environments.
 */
export const DEFAULT_COMPANY_LOGO_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEYAAAA9CAYAAAAQyx+GAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAE40lEQVR4nN2cP4vUQBTA5yOsjWD3QGvZL3CwYCGI4paCTQo/wFW2k869QgiHxRYiaRTRK6Y5FEGJIHKCYPBsDiwiOKiNrNjYjczm5S6XSyYzk5lNdgOP20B2duY3799M3hwhK74EIyAYCQQjoWAkEYykghHRIAmKfHYqGBmRTboEI2PBSCQYyRQQdCXFtoCs6yVyzVBpRFeR2hSQNQOSeQRSFflbUzJwk0lXCKROg4ZlYiJ3kLY+Qw6IYRshfk4stW4hGNkeApARDsIEhBz8xOA3JvgdE21kvUUxkZtOpjmLoQs1x3AfY5s6kzDqA8pCE8jIk6aGg4Ij9KBYqTJQvg2Ujww1KOkdjshnSmU+C9vcAiiPgfKXQPk7EzjYr+1e4Qi1A5RQxrZtA+VfgPIDoPwjUG7sj9BJqzSZ2fZNR21DhVg7V6A8AMoPgfJ9oHzs0cy7h3KgfAqUJ54lQEmB8i2N58OOcBadoiNQDkC58CxxBcpC83uhplk1aU3SBcwEO+HHLk/MR0LRcorSxFBrIgcOOegKJrRqIG+D39zZv14Xxe7u3n94Mfx2+Hvv3KFhym8UdRShPOsFDORmMsN8xjeUxmiIAcOd1oAmGFTvUzNV+I66zNQDlNYBKjLk1AsYyKF8AsrfFHBKUCZNUH49O3/kEEqsmZQ2RamxDzBbQPl7oPxxBQpUO+JJU7RnHLdD69qInIKBXFuiqqbUZceeoBjlIwpfkzkDAwildH8MBWFVk7JlSJZtlUCOfzy/0DSL3XIN8+UMWIGBHESMn+e4nglRohIU+UytzeNzS3vG9jJbMNg3E1lOBvo91ik6wQmYOc76qKopleeNoMi/LfspiaIt20xbam58dfb6dmXDPrIBk/mAIu9NweDazdVyRPYjwOyY2YCZ+YBiCgbXbrprKVMtGtuaUuQaigWY1ONidqENB07AHLRBwYGXnd0eUH4HP0/roJiA6ehXTOBA13Adl6AUK+QiSh2glhX3y6hW9xs6YBz7lTZJrMFAPZRR1Xx0LpuoZHPhWEJNHxUYgwGHUFYJptR/GV1ZCxhmBAYcQzEwpUCxzRlZwlE6cm0w4AGKAZiwk09Qj61JJjpf/geU/8QZkq83/uJ7H3n/HV91WG2Ef316ad4HGGy3MxjhQFKEccr5fX5yOV5HMCNPmWbvYDDvUvVN7RogT8NDX6KzuvYEJrR2viKvkkw8ywMs6aiTXfnMlXtv5y7BYPCwC9ci75gYgtzYeRG7AIPar2pL7V9wbzT1IEcewGQaJlvsIOr4vaRpJ91HYSHDv38EIx9MgV6bvXrkMwAoF5EeoQjNkjBbjXEJ5Wwk6rkEVfQMpnZLpMhXJgOWmUctOX5r0QTG5+6Y6CiuNSbVrvMrvfMZotxy0Ibc7JqU6oXdVo+LfEe9KVnrr+D4bCApKssLKfutqI+KzbRPOPgaNu2lf6K9+E+Csy4u7NCvtorNbrV3mp2YaoRa60osCy1WLUYLKKuZLJG/4myDk5ocprDsQzYYKBXN0clsE5cHrQwOiq0eisUJlKKjkSkkNJepwamTQlv7gVITIk1T/hQH21RpziyXK/EQUodqntNp0bixZyNFrj2r3ujydi7K+SXMTqJtPpAGDQosfVCTsLU6b20QXSIM4TratNjof2NAFBeG/GL1W0iv56f/Aza8ZYvPkTFbAAAAAElFTkSuQmCC'

/**
 * Resolves a reliable base64 image data URL from input logo path/URL.
 */
export function resolveLogoDataUrl(logo?: string | null): string {
  if (!logo || logo === '/logo_icons.png' || logo === 'logo_icons.png' || logo === '/logo_icons.webp' || logo === 'logo_icons.webp') {
    return DEFAULT_COMPANY_LOGO_BASE64
  }
  if (logo.startsWith('data:image/')) {
    return logo
  }
  if (/^[A-Za-z0-9+/=]{100,}$/.test(logo.trim())) {
    return `data:image/png;base64,${logo.trim()}`
  }
  return DEFAULT_COMPANY_LOGO_BASE64
}
