export type GroupTab = 'repositories' | 'registry' | 'members' | 'teams' | 'roles' | 'machine-users' | 'audit' | 'secrets' | 'import' | 'settings'

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
  } else if (rest === 'teams') {
    tab = 'teams'
  } else if (rest === 'roles') {
    tab = 'roles'
  } else if (rest === 'machine-users') {
    tab = 'machine-users'
  } else if (rest === 'audit') {
    tab = 'audit'
  } else if (rest === 'secrets') {
    tab = 'secrets'
  } else if (rest === 'import') {
    tab = 'import'
  } else if (rest === 'settings') {
    tab = 'settings'
  }

  return { orgSlug, tab, basePath }
}

export function groupTabPath(basePath: string, tab: GroupTab) {
  if (tab === 'repositories') return basePath
  return `${basePath}/${tab}`
}
