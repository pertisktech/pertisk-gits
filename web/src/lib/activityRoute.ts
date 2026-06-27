export type ActivityTab = 'merge-requests' | 'approve-users'

const ACTIVITY_PATH = /^\/activity(?:\/(.*))?$/

export function parseActivityRoute(pathname: string) {
  const match = pathname.match(ACTIVITY_PATH)
  if (!match) return null

  const rest = match[1] ?? ''
  let tab: ActivityTab = 'merge-requests'
  if (rest === 'approve-users') tab = 'approve-users'

  return { tab, basePath: '/activity' as const }
}

export function activityTabPath(basePath: string, tab: ActivityTab) {
  if (tab === 'merge-requests') return `${basePath}/merge-requests`
  return `${basePath}/${tab}`
}
