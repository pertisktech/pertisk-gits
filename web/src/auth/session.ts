let sessionExpiredHandler: (() => void) | null = null
let handlingExpired = false

export function registerSessionExpiredHandler(handler: (() => void) | null) {
  sessionExpiredHandler = handler
}

export function handleSessionExpired() {
  if (handlingExpired) return
  handlingExpired = true
  try {
    sessionExpiredHandler?.()
  } finally {
    window.setTimeout(() => {
      handlingExpired = false
    }, 1000)
  }
}

export function handleUnauthorizedResponse(status: number, hadAuthToken: boolean) {
  if (status === 401 && hadAuthToken) {
    handleSessionExpired()
  }
}

/** Best-effort JWT expiry check for browser session tokens (not API tokens). */
export function isJwtExpired(token: string, skewSeconds = 30): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false

  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown }
    if (typeof payload.exp !== 'number') return false
    return payload.exp <= Math.floor(Date.now() / 1000) + skewSeconds
  } catch {
    return false
  }
}
