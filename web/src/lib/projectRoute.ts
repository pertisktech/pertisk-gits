export type ProjectTab = 'code' | 'issues' | 'pulls' | 'commits' | 'pipelines' | 'settings'

const PROJECT_PATH = /^\/groups\/([^/]+)\/projects\/([^/]+)(?:\/(.*))?$/

export function parseProjectRoute(pathname: string, searchParams: URLSearchParams) {
  const match = pathname.match(PROJECT_PATH)
  if (!match) return null

  const orgSlug = match[1]
  const projectSlug = match[2]
  const rest = match[3] ?? ''
  const basePath = `/groups/${orgSlug}/projects/${projectSlug}`

  let tab: ProjectTab = 'code'
  if (rest.startsWith('issues/')) {
    tab = 'issues'
  } else if (rest.startsWith('pulls/')) {
    tab = 'pulls'
  } else if (rest.startsWith('commit/')) {
    tab = 'commits'
  } else if (rest.startsWith('pipelines/')) {
    tab = 'pipelines'
  } else {
    const requested = searchParams.get('tab')
    if (
      requested === 'issues' ||
      requested === 'pulls' ||
      requested === 'commits' ||
      requested === 'pipelines' ||
      requested === 'settings'
    ) {
      tab = requested
    }
  }

  return { orgSlug, projectSlug, tab, basePath }
}

export function projectTabPath(basePath: string, tab: ProjectTab) {
  if (tab === 'code') return basePath
  return `${basePath}?tab=${tab}`
}
