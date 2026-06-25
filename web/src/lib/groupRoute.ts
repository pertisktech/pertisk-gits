export type GroupTab = 'repositories' | 'registry' | 'members' | 'audit' | 'secrets'

const GROUP_PATH = /^\/groups\/([^/]+)(?:\/(.*))?$/

export function parseGroupRoute(pathname: string) {
  const match = pathname.match(GROUP_PATH)
  if (!match) return null

  const orgSlug = match[1]
  const rest = match[2] ?? ''

  if (/^projects\/[^/]+/.test(rest) && rest !== 'projects/new') {
    return null
  }

  const basePath = `/groups/${orgSlug}`

  let tab: GroupTab = 'repositories'
  if (rest === 'registry' || rest.startsWith('registry/')) {
    tab = 'registry'
  } else if (rest === 'members') {
    tab = 'members'
  } else if (rest === 'audit') {
    tab = 'audit'
  } else if (rest === 'secrets') {
    tab = 'secrets'
  }

  return { orgSlug, tab, basePath }
}

export function groupTabPath(basePath: string, tab: GroupTab) {
  if (tab === 'repositories') return basePath
  return `${basePath}/${tab}`
}
