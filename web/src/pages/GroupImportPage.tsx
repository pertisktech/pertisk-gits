import { useOrgPathParam } from '../hooks/useOrgPathParam'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ImportJobDetail, ImportOnConflict, ImportProvider, RemoteNamespace, RemoteRepo } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { StatusBadge } from '../components/StatusBadge'
import { Card } from '../components/Card'
import {
  Breadcrumbs,
  Checkbox,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Select,
  TablePagination,
} from '../components/ui'
import { chunkImportRepos, DEFAULT_IMPORT_MAX_REPOS_PER_JOB } from '../lib/importLimits'
import { groupBreadcrumbItems } from '../lib/groupRoute'
import { useClientPagination } from '../lib/pagination'
import { slugify, slugifyPath, remoteNamespaceLabel, importProviderLabel } from '../lib/slugify'

const fieldClass =
  'w-full px-3 py-2 rounded-lg border border-naturals-n4 bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

function jobStatusVariant(status: string) {
  if (status === 'done') return 'green' as const
  if (status === 'failed') return 'red' as const
  if (status === 'skipped') return 'gray' as const
  if (status === 'pending') return 'gray' as const
  if (status === 'metadata') return 'violet' as const
  return 'yellow' as const
}

function parseImportProvider(value: string | null): ImportProvider {
  if (value === 'gitlab') return 'gitlab'
  if (value === 'pertisk') return 'pertisk'
  return 'github'
}

function isGitOnlyImport(provider: ImportProvider) {
  return provider === 'pertisk'
}

export function GroupImportPage() {
  const { pathname } = useLocation()
  const routeOrgPath = useOrgPathParam()
  const isGlobalImport = pathname === '/groups/import'
  const [searchParams] = useSearchParams()
  const { token, user } = useAuth()
  const queryClient = useQueryClient()

  const [provider, setProvider] = useState<ImportProvider>(() =>
    parseImportProvider(searchParams.get('provider')),
  )
  const [createdOrgPath, setCreatedOrgPath] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [targetGroupPath, setTargetGroupPath] = useState('')
  const [groupPathTouched, setGroupPathTouched] = useState(false)
  const [pat, setPat] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [credentialId, setCredentialId] = useState<string | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [remoteRepos, setRemoteRepos] = useState<RemoteRepo[]>([])
  const [namespaces, setNamespaces] = useState<RemoteNamespace[]>([])
  const [namespacePath, setNamespacePath] = useState('')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [importIssues, setImportIssues] = useState(false)
  const [importPullRequests, setImportPullRequests] = useState(false)
  const [importWiki, setImportWiki] = useState(false)
  const [onConflict, setOnConflict] = useState<ImportOnConflict>('override')
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [maxReposPerJob, setMaxReposPerJob] = useState(DEFAULT_IMPORT_MAX_REPOS_PER_JOB)

  const activeOrgPath = useMemo(() => {
    if (!isGlobalImport) return routeOrgPath
    return createdOrgPath
  }, [isGlobalImport, routeOrgPath, createdOrgPath])

  useEffect(() => {
    setProvider(parseImportProvider(searchParams.get('provider')))
  }, [searchParams])

  useEffect(() => {
    if (!isGitOnlyImport(provider)) return
    setImportIssues(false)
    setImportPullRequests(false)
    setImportWiki(false)
  }, [provider])

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

  const conflictingGroup = useMemo(() => {
    const path = targetGroupPath.trim()
    if (!path || !isGlobalImport) return undefined
    return groups.find(
      (group) => (group.full_path || group.slug) === path,
    )
  }, [targetGroupPath, groups, isGlobalImport])

  const applyRemoteNamespaceToGroup = useCallback(
    (path: string) => {
      if (!path || groupPathTouched) return
      const ns = namespaces.find((item) => item.path === path)
      const label = ns?.name ?? path.split('/').pop() ?? path
      setNewGroupName(label)
      setTargetGroupPath(slugifyPath(path))
    },
    [namespaces, groupPathTouched],
  )

  const existingRepoCount = useMemo(
    () => remoteRepos.filter((repo) => repo.already_exists).length,
    [remoteRepos],
  )

  function selectExistingForReimport() {
    setOnConflict('override')
    setSelected((prev) => {
      const next = { ...prev }
      for (const repo of remoteRepos) {
        if (repo.already_exists) next[repo.id] = true
      }
      return next
    })
  }

  const { data: members = [] } = useQuery({
    queryKey: ['org-members', activeOrgPath],
    queryFn: () => api.listOrganizationMembers(token!, activeOrgPath),
    enabled: Boolean(token && activeOrgPath),
  })

  const canManage = useMemo(() => {
    if (isGlobalImport && !createdOrgPath) return true
    const role = members.find((member) => member.user.id === user?.id)?.role
    return role === 'owner' || role === 'admin'
  }, [isGlobalImport, createdOrgPath, members, user?.id])

  const { data: credentials = [] } = useQuery({
    queryKey: ['import-credentials', user?.id],
    queryFn: () => api.listMyImportCredentials(token!),
    enabled: Boolean(token && (isGlobalImport || (activeOrgPath && canManage))),
  })

  useEffect(() => {
    if (!credentialId) return
    const cred = credentials.find((entry) => entry.id === credentialId)
    if (!cred?.base_url) return
    if (cred.provider === 'github' && cred.base_url === 'https://github.com') {
      setBaseUrl('')
      return
    }
    if (cred.provider === 'gitlab' && cred.base_url === 'https://gitlab.com') {
      setBaseUrl('')
      return
    }
    setBaseUrl(cred.base_url)
  }, [credentialId, credentials])

  const matchingCredentials = useMemo(
    () => credentials.filter((cred) => cred.provider === provider),
    [credentials, provider],
  )

  const { data: jobs = [] } = useQuery({
    queryKey: ['import-jobs', activeOrgPath],
    queryFn: () => api.listImportJobs(token!, activeOrgPath),
    enabled: Boolean(token && activeOrgPath && canManage),
    refetchInterval: activeJobId ? 3000 : false,
  })

  const {
    items: pageJobs,
    page: jobsPage,
    setPage: setJobsPage,
    pageSize: jobsPageSize,
    total: jobsTotal,
  } = useClientPagination(jobs)

  const { data: activeJob } = useQuery({
    queryKey: ['import-job', activeOrgPath, activeJobId],
    queryFn: () => api.getImportJob(token!, activeOrgPath, activeJobId!),
    enabled: Boolean(token && activeOrgPath && activeJobId),
    refetchInterval: (query) => {
      const job = query.state.data as ImportJobDetail | undefined
      if (!job) return 3000
      return job.status === 'done' || job.status === 'failed' ? false : 3000
    },
  })

  useEffect(() => {
    if (!activeJob || !activeOrgPath) return
    if (activeJob.status === 'done' || activeJob.status === 'failed') {
      queryClient.invalidateQueries({ queryKey: ['repositories', activeOrgPath] })
      queryClient.invalidateQueries({ queryKey: ['import-jobs', activeOrgPath] })
    }
  }, [activeJob, queryClient, activeOrgPath])

  useEffect(() => {
    if (!isGlobalImport || groupPathTouched) return
    if (namespacePath) {
      applyRemoteNamespaceToGroup(namespacePath)
      return
    }
    if (account && namespaces.length === 0) {
      setNewGroupName(account)
      setTargetGroupPath(slugify(account))
    }
  }, [isGlobalImport, namespacePath, namespaces, account, groupPathTouched, applyRemoteNamespaceToGroup])

  const ensureTargetOrg = useCallback(async (): Promise<string> => {
    if (!isGlobalImport) {
      if (!routeOrgPath) throw new Error('No target group')
      return routeOrgPath
    }
    if (createdOrgPath) return createdOrgPath

    const path = targetGroupPath.trim()
    const name = newGroupName.trim()
    if (!path) {
      throw new Error(
        provider === 'github'
          ? 'Select a GitHub organization before listing repositories'
          : provider === 'pertisk'
            ? 'Select a Pertisk group before listing repositories'
            : 'Select a GitLab group before listing repositories',
      )
    }

    const existing = groups.find((group) => (group.full_path || group.slug) === path)
    if (existing) {
      const fullPath = existing.full_path || existing.slug
      setCreatedOrgPath(fullPath)
      return fullPath
    }

    const group = await api.ensureImportGroup(token!, {
      path,
    })
    const fullPath = group.full_path || group.slug
    setCreatedOrgPath(fullPath)
    if (!name) setNewGroupName(group.name)
    queryClient.invalidateQueries({ queryKey: ['organizations'] })
    return fullPath
  }, [
    isGlobalImport,
    routeOrgPath,
    createdOrgPath,
    newGroupName,
    targetGroupPath,
    provider,
    token,
    queryClient,
    groups,
  ])

  const connect = useMutation({
    mutationFn: async () => {
      if (!pat.trim()) throw new Error('Enter a personal access token')
      if (provider === 'pertisk' && !baseUrl.trim()) {
        throw new Error('Enter the source Pertisk Gits server URL')
      }
      return api.previewImport(token!, {
        provider,
        token: pat,
        base_url: baseUrl.trim() || undefined,
      })
    },
    onSuccess: (result) => {
      setAccount(result.account)
      setNamespaces(result.namespaces)
      setNamespacePath('')
      setRemoteRepos([])
      setSelected({})
      setCredentialId(null)
      setCreatedOrgPath('')
      setGroupPathTouched(false)
      if (result.namespaces.length === 1) {
        setNamespacePath(result.namespaces[0].path)
      }
    },
  })

  const discoverPayload = useMemo(() => {
    const credId = credentialId ?? undefined
    if (namespacePath) {
      const ns = namespaces.find((item) => item.path === namespacePath)
      return {
        credential_id: credId,
        namespace: namespacePath,
        namespace_kind: ns?.kind,
      }
    }
    return { credential_id: credId }
  }, [credentialId, namespacePath, namespaces])

  const discover = useMutation({
    mutationFn: async () => {
      if (provider === 'pertisk' && !baseUrl.trim() && !credentialId) {
        throw new Error('Enter the source Pertisk Gits server URL')
      }
      const org = await ensureTargetOrg()
      if (pat.trim()) {
        const saved = await api.saveImportCredential(token!, org, {
          provider,
          token: pat,
          base_url: baseUrl.trim() || undefined,
        })
        setCredentialId(saved.id)
        queryClient.invalidateQueries({ queryKey: ['import-credentials'] })
        return api.discoverImportRepos(token!, org, {
          ...discoverPayload,
          credential_id: saved.id,
        })
      }
      if (!credentialId) {
        throw new Error('Enter a personal access token or select a saved credential')
      }
      return api.discoverImportRepos(token!, org, discoverPayload)
    },
    onSuccess: (result) => {
      setAccount(result.account)
      setNamespaces(result.namespaces)
      setRemoteRepos(result.repos)
      setMaxReposPerJob(result.max_repos_per_job)
      const initial: Record<string, boolean> = {}
      for (const repo of result.repos) {
        initial[repo.id] = false
      }
      setSelected(initial)
    },
  })

  const refreshRepos = useMutation({
    mutationFn: async () => {
      const org = await ensureTargetOrg()
      if (!credentialId) throw new Error('Save credentials before listing repositories')
      return api.discoverImportRepos(token!, org, discoverPayload)
    },
    onSuccess: (result) => {
      setNamespaces(result.namespaces)
      setRemoteRepos(result.repos)
      setMaxReposPerJob(result.max_repos_per_job)
      const initial: Record<string, boolean> = {}
      for (const repo of result.repos) {
        initial[repo.id] = false
      }
      setSelected(initial)
    },
  })

  const startImport = useMutation({
    mutationFn: async () => {
      const org = await ensureTargetOrg()
      const id = credentialId
      if (!id) throw new Error('Save credentials before importing')
      const repos = remoteRepos
        .filter((repo) => selected[repo.id])
        .map((repo) => ({
          source_id: repo.id,
          source_full_name: repo.full_name,
          source_clone_url: repo.clone_url,
          target_name: repo.name,
          description: repo.description ?? undefined,
          visibility: repo.visibility,
          default_branch: repo.default_branch,
        }))
      const batches = chunkImportRepos(repos, maxReposPerJob)
      let lastJob: ImportJobDetail | null = null
      for (const batch of batches) {
        lastJob = await api.createImportJob(token!, org, {
          credential_id: id,
          import_issues: importIssues,
          import_pull_requests: importPullRequests,
          import_wiki: importWiki,
          on_conflict: onConflict,
          repos: batch,
        })
      }
      if (!lastJob) throw new Error('Select at least one repository')
      return { job: lastJob, jobCount: batches.length }
    },
    onSuccess: ({ job }) => {
      setActiveJobId(job.id)
      queryClient.invalidateQueries({ queryKey: ['import-jobs', activeOrgPath] })
    },
  })

  useEffect(() => {
    if (!credentialId || !account || !activeOrgPath) return
    refreshRepos.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when namespace filter changes
  }, [namespacePath])

  useEffect(() => {
    if (!isGlobalImport) return
    setCredentialId(null)
    setRemoteRepos([])
    setSelected({})
    setActiveJobId(null)
    setCreatedOrgPath('')
    setAccount(null)
    setNamespaces([])
    setNamespacePath('')
  }, [isGlobalImport, provider])

  const selectedCount = Object.values(selected).filter(Boolean).length
  const importJobCount = Math.max(1, Math.ceil(selectedCount / maxReposPerJob))

  const {
    items: pageRemoteRepos,
    page: repoPage,
    setPage: setRepoPage,
    resetPage: resetRepoPage,
    pageSize: repoPageSize,
    total: remoteRepoTotal,
  } = useClientPagination(remoteRepos)

  useEffect(() => {
    resetRepoPage()
  }, [namespacePath, remoteRepos.length, resetRepoPage])

  const connectStep = 1
  const selectStep = 2

  const breadcrumbItems = isGlobalImport
    ? [{ label: 'Groups', to: '/groups' }, { label: 'Import' }]
    : [...groupBreadcrumbItems(routeOrgPath, groups), { label: 'Import' }]

  const targetPreview = isGlobalImport
    ? targetGroupPath.trim() || 'your-group'
    : activeOrgPath || routeOrgPath

  const previewReady = isGlobalImport ? Boolean(account) : true
  const namespaceRequired = isGlobalImport && namespaces.length > 0
  const canListRepos =
    previewReady && (!namespaceRequired || Boolean(namespacePath)) && Boolean(targetGroupPath.trim() || !isGlobalImport)

  if (!isGlobalImport && !canManage && members.length > 0) {
    return <Navigate to={`/groups/${routeOrgPath}`} replace />
  }

  return (
    <>
      <Breadcrumbs items={breadcrumbItems} />
      <PageHeader
        title="Import repositories"
        subtitle={
          isGlobalImport
            ? 'Connect with GitHub, GitLab, or another Pertisk Gits server, pick a source group, and import repositories. Saved tokens work across all groups on this instance.'
            : 'Mirror projects from GitHub, GitLab, or another Pertisk Gits server into this group. Re-import from the same source to refresh mirrors; saved tokens are shared across your groups.'
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-text mb-3">{connectStep}. Connect</h2>
          <div className="space-y-3">
            <form
              autoComplete="off"
              onSubmit={(event) => event.preventDefault()}
              className="space-y-3"
            >
              <Select
                label="Source"
                value={provider}
                onChange={(event) => setProvider(event.target.value as ImportProvider)}
                autoComplete="off"
              >
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
                <option value="pertisk">Pertisk Gits</option>
              </Select>

              {provider === 'pertisk' && (
                <label className="block text-sm font-medium text-text">
                  Source server URL
                  <input
                    className={`${fieldClass} mt-1 font-mono`}
                    placeholder="https://git.example.com"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    name="pertisk-import-server-url"
                    autoComplete="off"
                    readOnly
                    onFocus={(event) => event.currentTarget.removeAttribute('readonly')}
                  />
                  <span className="text-xs text-text-secondary mt-1 block">
                    Public URL of the other Pertisk Gits instance (Server A).
                  </span>
                </label>
              )}

              {provider === 'gitlab' && (
                <label className="block text-sm font-medium text-text">
                  GitLab URL (optional)
                  <input
                    className={`${fieldClass} mt-1 font-mono`}
                    placeholder="https://gitlab.com"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    name="pertisk-import-gitlab-url"
                    autoComplete="off"
                    readOnly
                    onFocus={(event) => event.currentTarget.removeAttribute('readonly')}
                  />
                </label>
              )}

              {provider === 'github' && (
                <label className="block text-sm font-medium text-text">
                  GitHub URL (optional)
                  <input
                    className={`${fieldClass} mt-1 font-mono`}
                    placeholder="https://github.com"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    name="pertisk-import-github-url"
                    autoComplete="off"
                    readOnly
                    onFocus={(event) => event.currentTarget.removeAttribute('readonly')}
                  />
                  <span className="text-xs text-text-secondary mt-1 block">
                    Leave blank for github.com. For GitHub Enterprise Server, use your instance URL
                    (e.g. https://github.mycompany.com).
                  </span>
                </label>
              )}

              {matchingCredentials.length > 0 && (
                <Select
                  label="Saved connection"
                  hint={`Reuse a ${importProviderLabel(provider)} token you already saved for this source.`}
                  value={credentialId ?? ''}
                  onChange={(event) => {
                    setCredentialId(event.target.value || null)
                    setPat('')
                  }}
                >
                  <option value="">Use new token below</option>
                  {matchingCredentials.map((cred) => (
                    <option key={cred.id} value={cred.id}>
                      {cred.label ?? cred.provider}
                      {cred.base_url ? ` · ${cred.base_url}` : ''}
                    </option>
                  ))}
                </Select>
              )}

              <label className="block text-sm font-medium text-text">
                Personal access token
                <input
                  type="password"
                  className={`${fieldClass} mt-1 font-mono`}
                  placeholder={
                    provider === 'github' ? 'ghp_…' : provider === 'pertisk' ? 'pgs_…' : 'glpat-…'
                  }
                  value={pat}
                  onChange={(event) => setPat(event.target.value)}
                  name="pertisk-import-pat"
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  readOnly
                  onFocus={(event) => event.currentTarget.removeAttribute('readonly')}
                />
                <span className="text-xs text-text-secondary mt-1 block">
                  {provider === 'github'
                    ? 'Classic PAT: enable the repo scope. Fine-grained PAT: grant read access to Contents and Metadata for target repositories.'
                    : provider === 'pertisk'
                      ? 'Create an API token on the source server (Profile → API tokens). Needs read access to the groups and repositories you import.'
                      : 'Needs read_api and read_repository scopes. Stored encrypted; never shown again.'}
                </span>
              </label>

              {isGlobalImport && !account && (
                <>
                  {connect.error && (
                    <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
                      {(connect.error as Error).message}
                    </div>
                  )}
                  <PrimaryButton
                    type="button"
                    disabled={connect.isPending || !pat.trim()}
                    onClick={() => connect.mutate()}
                  >
                    {connect.isPending ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Connecting…
                      </>
                    ) : (
                      'Connect'
                    )}
                  </PrimaryButton>
                </>
              )}

              {isGlobalImport && account && (
                <p className="text-xs text-text-secondary">
                  Signed in as <span className="font-mono text-text">{account}</span>
                </p>
              )}

              {isGlobalImport && previewReady && namespaces.length > 0 && (
                <Select
                  label={remoteNamespaceLabel(provider)}
                  hint={`Repositories are listed from this ${remoteNamespaceLabel(provider)} on ${importProviderLabel(provider)}.`}
                  value={namespacePath}
                  onChange={(event) => {
                    setGroupPathTouched(false)
                    setNamespacePath(event.target.value)
                  }}
                >
                  <option value="">
                    Select {provider === 'github' ? 'an organization' : 'a group'}…
                  </option>
                  {namespaces.map((ns) => (
                    <option key={ns.id} value={ns.path}>
                      {ns.path}
                    </option>
                  ))}
                </Select>
              )}

              {isGlobalImport && previewReady && (
                <div className="space-y-3 rounded-lg border border-naturals-n4 bg-surface-hover/40 p-3">
                  <p className="text-sm font-medium text-text">Pertisk group</p>
                  <p className="text-xs text-text-secondary">
                    Created automatically from the selected {remoteNamespaceLabel(provider)}.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-text">
                      Group name
                      <input
                        className={`${fieldClass} mt-1`}
                        value={newGroupName}
                        disabled={Boolean(createdOrgPath)}
                        placeholder="My team"
                        onChange={(event) => setNewGroupName(event.target.value)}
                      />
                    </label>
                    <label className="block text-sm font-medium text-text">
                      Group path
                      <input
                        className={`${fieldClass} mt-1 font-mono`}
                        value={targetGroupPath}
                        disabled={Boolean(createdOrgPath)}
                        placeholder="my-team"
                        onChange={(event) => {
                          setGroupPathTouched(true)
                          setTargetGroupPath(event.target.value)
                        }}
                      />
                      <span className="text-xs text-text-secondary mt-1 block font-mono">
                        pertisk-gits/{targetPreview}
                      </span>
                    </label>
                  </div>
                  {conflictingGroup && (
                    <p className="text-xs text-text-secondary">
                      Group{' '}
                      <span className="font-mono text-text">
                        {conflictingGroup.full_path || conflictingGroup.slug}
                      </span>{' '}
                      already exists — import will use that group.
                    </p>
                  )}
                  {createdOrgPath && (
                    <p className="text-xs text-text-secondary">
                      Group{' '}
                      <Link to={`/groups/${createdOrgPath}`} className="font-mono text-primary hover:underline">
                        {createdOrgPath}
                      </Link>{' '}
                      is ready.
                    </p>
                  )}
                </div>
              )}

              {discover.error && (
                <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
                  {(discover.error as Error).message}
                </div>
              )}

              {(!isGlobalImport || previewReady) && (
                <PrimaryButton
                  type="button"
                  disabled={discover.isPending || !canListRepos || (!isGlobalImport && !pat.trim() && !credentialId)}
                  onClick={() => discover.mutate()}
                >
                  {discover.isPending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Listing repositories…
                    </>
                  ) : (
                    'List repositories'
                  )}
                </PrimaryButton>
              )}
            </form>
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-text mb-3">{selectStep}. Select repositories</h2>
          {remoteRepos.length === 0 && (
            <p className="text-sm text-text-secondary">
              {isGlobalImport
                ? 'Connect with a token, pick a GitHub organization or GitLab group, then list repositories.'
                : 'Connect with a token to see repositories you can import.'}
            </p>
          )}
          {account && (
            <p className="text-xs text-muted mb-3">
              Signed in as <span className="font-mono">{account}</span> · {remoteRepos.length}{' '}
              repositories
              {namespacePath ? (
                <>
                  {' '}
                  in <span className="font-mono">{namespacePath}</span>
                </>
              ) : null}
              {activeOrgPath ? (
                <>
                  {' '}
                  → <span className="font-mono">{activeOrgPath}</span>
                </>
              ) : null}
            </p>
          )}
          {namespaces.length > 0 && !isGlobalImport && (
            <div className="mb-3">
              <Select
                label={remoteNamespaceLabel(provider)}
                hint="Filter repositories on GitHub/GitLab — not your Pertisk group."
                value={namespacePath}
                onChange={(event) => setNamespacePath(event.target.value)}
                disabled={refreshRepos.isPending}
              >
                <option value="">All accessible repositories</option>
                {namespaces.map((ns) => (
                  <option key={ns.id} value={ns.path}>
                    {ns.name}
                  </option>
                ))}
              </Select>
              {credentialId && (
                <SecondaryButton
                  type="button"
                  className="mt-2"
                  disabled={refreshRepos.isPending}
                  onClick={() => refreshRepos.mutate()}
                >
                  {refreshRepos.isPending ? 'Refreshing…' : 'Refresh list'}
                </SecondaryButton>
              )}
            </div>
          )}
          {refreshRepos.error && (
            <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm mb-3">
              {(refreshRepos.error as Error).message}
            </div>
          )}
          {remoteRepos.length > 0 && (
            <div className="space-y-3">
              <Select
                label="If repository already exists"
                value={onConflict}
                onChange={(event) => setOnConflict(event.target.value as ImportOnConflict)}
              >
                <option value="override">
                  {isGitOnlyImport(provider)
                    ? 'Re-import (update mirror)'
                    : 'Re-import (update mirror and metadata)'}
                </option>
                <option value="skip">Skip existing repositories</option>
              </Select>
              {existingRepoCount > 0 && (
                <p className="text-xs text-text-secondary">
                  {existingRepoCount} repositories in this list already exist in the target group.
                  {onConflict === 'skip'
                    ? ' Existing ones will be skipped during import.'
                    : ' Existing ones will be updated from the remote mirror.'}
                </p>
              )}
              {!isGitOnlyImport(provider) && (
                <>
                  <Checkbox
                    row
                    label="Import issues, labels, and milestones (open and closed)"
                    checked={importIssues}
                    onChange={(event) => setImportIssues(event.target.checked)}
                  />
                  <Checkbox
                    row
                    label="Import open pull/merge requests (title, body, branches)"
                    checked={importPullRequests}
                    onChange={(event) => setImportPullRequests(event.target.checked)}
                  />
                  <Checkbox
                    row
                    label="Import wiki pages (GitHub wiki git repo or GitLab wiki API)"
                    checked={importWiki}
                    onChange={(event) => setImportWiki(event.target.checked)}
                  />
                </>
              )}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <SecondaryButton
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = {}
                    for (const repo of remoteRepos) {
                      next[repo.id] = true
                    }
                    setSelected(next)
                  }}
                >
                  Select all
                </SecondaryButton>
                {existingRepoCount > 0 && (
                  <SecondaryButton type="button" onClick={selectExistingForReimport}>
                    Re-import existing ({existingRepoCount})
                  </SecondaryButton>
                )}
                <SecondaryButton
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = {}
                    for (const repo of remoteRepos) {
                      next[repo.id] = false
                    }
                    setSelected(next)
                  }}
                >
                  Clear
                </SecondaryButton>
                {remoteRepos.length > maxReposPerJob && (
                  <span className="text-xs text-text-secondary">
                    {remoteRepos.length} repositories — imports run in batches of up to {maxReposPerJob}{' '}
                    per job.
                  </span>
                )}
              </div>
              <div className="border border-naturals-n4 rounded-lg divide-y divide-naturals-n4">
                {pageRemoteRepos.map((repo) => (
                  <Checkbox
                    key={repo.id}
                    className="items-start gap-3 px-3 py-2 hover:bg-surface-hover w-full rounded-none"
                    checked={Boolean(selected[repo.id])}
                    onChange={(event) =>
                      setSelected((prev) => ({ ...prev, [repo.id]: event.target.checked }))
                    }
                    label={
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm text-text truncate">
                            {repo.full_name}
                          </span>
                          {repo.already_exists && (
                            <StatusBadge variant="yellow">Already exists</StatusBadge>
                          )}
                        </span>
                        {repo.existing_path && (
                          <span className="text-xs text-text-secondary font-mono block truncate">
                            → {repo.existing_path}
                          </span>
                        )}
                        {repo.description && (
                          <span className="text-xs text-text-secondary line-clamp-2">
                            {repo.description}
                          </span>
                        )}
                      </span>
                    }
                  />
                ))}
              </div>

              {remoteRepoTotal > 0 && (
                <TablePagination
                  page={repoPage}
                  pageSize={repoPageSize}
                  total={remoteRepoTotal}
                  onPageChange={setRepoPage}
                  itemLabel="repositories"
                />
              )}

              {startImport.error && (
                <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
                  {(startImport.error as Error).message}
                </div>
              )}

              <PrimaryButton
                type="button"
                disabled={selectedCount === 0 || startImport.isPending}
                onClick={() => startImport.mutate()}
              >
                {startImport.isPending
                  ? 'Starting import…'
                  : importJobCount > 1
                    ? `Import ${selectedCount} repositories (${importJobCount} jobs)`
                    : `Import ${selectedCount} repositories`}
              </PrimaryButton>
            </div>
          )}
        </Card>
      </div>

      {(activeJob || jobs.length > 0) && activeOrgPath && (
        <Card className="mt-4">
          <h2 className="text-sm font-semibold text-text mb-3 flex items-center gap-2">
            <Download size={16} />
            Import jobs
          </h2>

          {activeJob && (
            <div className="mb-4 p-3 rounded-lg border border-naturals-n4 bg-surface">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="font-mono text-xs text-muted">{activeJob.id}</span>
                <StatusBadge variant={jobStatusVariant(activeJob.status)}>
                  {activeJob.status}
                </StatusBadge>
              </div>
              {activeJob.error_message && (
                <p className="text-sm text-dashboard-danger mb-2">{activeJob.error_message}</p>
              )}
              <table className="app-list-table text-sm">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Target</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activeJob.repos.map((repo) => (
                    <tr key={repo.id}>
                      <td className="font-mono">{repo.source_full_name}</td>
                      <td>
                        {repo.repository_id ? (
                          <Link
                            to={`/groups/${activeOrgPath}/projects/${repo.target_slug}`}
                            className="font-mono text-primary hover:underline"
                          >
                            {activeOrgPath}/{repo.target_slug}
                          </Link>
                        ) : (
                          <span className="font-mono text-text-secondary">
                            {activeOrgPath}/{repo.target_slug}
                          </span>
                        )}
                      </td>
                      <td>
                        <StatusBadge variant={jobStatusVariant(repo.status)}>
                          {repo.status}
                        </StatusBadge>
                        {repo.error_message && (
                          <div className="text-xs text-dashboard-danger mt-1">{repo.error_message}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {jobs.length > 0 && (
            <table className="app-list-table text-sm">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{new Date(job.created_at).toLocaleString()}</td>
                    <td className="capitalize">{job.provider}</td>
                    <td>
                      <StatusBadge variant={jobStatusVariant(job.status)}>{job.status}</StatusBadge>
                    </td>
                    <td>
                      <SecondaryButton type="button" onClick={() => setActiveJobId(job.id)}>
                        View
                      </SecondaryButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {jobsTotal > 0 && (
            <TablePagination
              page={jobsPage}
              pageSize={jobsPageSize}
              total={jobsTotal}
              onPageChange={setJobsPage}
              itemLabel="jobs"
            />
          )}
        </Card>
      )}
    </>
  )
}
