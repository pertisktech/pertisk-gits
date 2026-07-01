export type AdminTab = 'system' | 'health' | 'configuration' | 'observability' | 'auth' | 'users' | 'runners' | 'backups'

const ADMIN_PATH = /^\/admin(?:\/(.*))?$/

export function parseAdminRoute(pathname: string) {
  const match = pathname.match(ADMIN_PATH)
  if (!match) return null

  const rest = match[1] ?? ''
  let tab: AdminTab = 'system'
  if (rest === 'health') tab = 'health'
  else if (rest === 'configuration') tab = 'configuration'
  else if (rest === 'observability') tab = 'observability'
  else if (rest === 'auth') tab = 'auth'
  else if (rest === 'users') tab = 'users'
  else if (rest === 'runners') tab = 'runners'
  else if (rest === 'backups') tab = 'backups'

  return { tab, basePath: '/admin' as const }
}

export function adminTabPath(basePath: string, tab: AdminTab) {
  if (tab === 'system') return basePath
  return `${basePath}/${tab}`
}
