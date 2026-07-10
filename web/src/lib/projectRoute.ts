export type ProjectTab =
  | 'code'
  | 'compare'
  | 'issues'
  | 'pulls'
  | 'commits'
  | 'branches'
  | 'tags'
  | 'registry'
  | 'pipelines'
  | 'wiki'
  | 'settings'

const PROJECT_PATH = /^\/groups\/(.+?)\/projects\/([^/]+)(?:\/(.*))?$/
const NEW_PROJECT_PATH = /^\/groups\/(.+?)\/projects\/new\/?$/

export const RESERVED_PROJECT_SLUGS = new Set(['new'])

export function parseNewProjectRoute(pathname: string) {
  const match = pathname.match(NEW_PROJECT_PATH)
  if (!match) return null
  return { orgPath: match[1].replace(/\/$/, '') }
}

export type ProjectSubRoute =
  | { kind: 'commit'; orgSlug: string; projectSlug: string; commitSha: string }
  | { kind: 'issue'; orgSlug: string; projectSlug: string; issueNumber: string }
  | { kind: 'pull'; orgSlug: string; projectSlug: string; pullNumber: string }
  | { kind: 'pipeline'; orgSlug: string; projectSlug: string; runId: string }

const PROJECT_SUB_ROUTES: {
  kind: ProjectSubRoute['kind']
  pattern: RegExp
  idKey: 'commitSha' | 'issueNumber' | 'pullNumber' | 'runId'
}[] = [
  {
    kind: 'commit',
    pattern: /^\/groups\/(.+?)\/projects\/([^/]+)\/commit\/([^/]+)\/?$/,
    idKey: 'commitSha',
  },
  {
    kind: 'issue',
    pattern: /^\/groups\/(.+?)\/projects\/([^/]+)\/issues\/([^/]+)\/?$/,
    idKey: 'issueNumber',
  },
  {
    kind: 'pull',
    pattern: /^\/groups\/(.+?)\/projects\/([^/]+)\/pulls\/([^/]+)\/?$/,
    idKey: 'pullNumber',
  },
  {
    kind: 'pipeline',
    pattern: /^\/groups\/(.+?)\/projects\/([^/]+)\/pipelines\/([^/]+)\/?$/,
    idKey: 'runId',
  },
]

export function parseProjectSubRoute(pathname: string): ProjectSubRoute | null {
  for (const { kind, pattern, idKey } of PROJECT_SUB_ROUTES) {
    const match = pathname.match(pattern)
    if (!match) continue
    const orgSlug = match[1].replace(/\/$/, '')
    const projectSlug = match[2]
    if (RESERVED_PROJECT_SLUGS.has(projectSlug)) return null
    const id = match[3]
    return { kind, orgSlug, projectSlug, [idKey]: id } as ProjectSubRoute
  }
  return null
}

export function parseProjectRoute(pathname: string, searchParams: URLSearchParams) {
  const match = pathname.match(PROJECT_PATH)
  if (!match) return null

  const orgSlug = match[1].replace(/\/$/, '')
  const projectSlug = match[2]
  if (RESERVED_PROJECT_SLUGS.has(projectSlug)) return null
  const rest = match[3] ?? ''
  const basePath = `/groups/${orgSlug}/projects/${projectSlug}`

  let tab: ProjectTab = 'code'
  if (rest === 'compare') {
    tab = 'compare'
  } else if (rest.startsWith('issues')) {
    tab = 'issues'
  } else if (rest.startsWith('pulls')) {
    tab = 'pulls'
  } else if (rest.startsWith('commit/') || rest === 'commits') {
    tab = 'commits'
  } else if (rest === 'branches') {
    tab = 'branches'
  } else if (rest === 'tags') {
    tab = 'tags'
  } else if (rest.startsWith('registry')) {
    tab = 'registry'
  } else if (rest.startsWith('pipelines')) {
    tab = 'pipelines'
  } else if (rest.startsWith('wiki')) {
    tab = 'wiki'
  } else if (rest === 'settings') {
    tab = 'settings'
  } else if (!rest) {
    const requested = searchParams.get('tab')
    if (
      requested === 'compare' ||
      requested === 'issues' ||
      requested === 'pulls' ||
      requested === 'commits' ||
      requested === 'branches' ||
      requested === 'tags' ||
      requested === 'registry' ||
      requested === 'pipelines' ||
      requested === 'wiki' ||
      requested === 'settings'
    ) {
      tab = requested
    }
  }

  return { orgSlug, projectSlug, tab, basePath }
}

export function projectTabPath(basePath: string, tab: ProjectTab) {
  if (tab === 'code') return basePath
  return `${basePath}/${tab}`
}

export function wikiPagePath(basePath: string, pageSlug: string) {
  return `${basePath}/${encodeURIComponent(pageSlug)}`
}
