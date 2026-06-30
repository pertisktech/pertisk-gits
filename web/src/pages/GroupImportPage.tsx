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
  Radio,
  RadioGroup,
  SecondaryButton,
  Select,
  TablePagination,
} from '../components/ui'
import { chunkImportRepos, DEFAULT_IMPORT_MAX_REPOS_PER_JOB } from '../lib/importLimits'
import { groupBreadcrumbItems } from '../lib/groupRoute'
import { useClientPagination } from '../lib/pagination'
import { slugify } from '../lib/slugify'

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
  return value === 'gitlab' ? 'gitlab' : 'github'
}

type TargetMode = 'new' | 'existing'

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
  const [targetMode, setTargetMode] = useState<TargetMode>('new')
  const [existingTargetPath, setExistingTargetPath] = useState('')
  const [createdOrgPath, setCreatedOrgPath] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupSlug, setNewGroupSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
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
  const [onConflict, setOnConflict] = useState<ImportOnConflict>('override')
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [maxReposPerJob, setMaxReposPerJob] = useState(DEFAULT_IMPORT_MAX_REPOS_PER_JOB)

  const activeOrgPath = useMemo(() => {
    if (!isGlobalImport) return routeOrgPath
    if (targetMode === 'existing') return existingTargetPath
    return createdOrgPath
  }, [isGlobalImport, routeOrgPath, targetMode, existingTargetPath, createdOrgPath])

  useEffect(() => {
    setProvider(parseImportProvider(searchParams.get('provider')))
  }, [searchParams])

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

  const topLevelGroups = useMemo(
    () => groups.filter((group) => !group.parent_id),
    [groups],
  )

  const conflictingGroup = useMemo(() => {
    const slug = newGroupSlug.trim()
    if (!slug || !isGlobalImport || targetMode !== 'new') return undefined
    return topLevelGroups.find(
      (group) => group.slug === slug || (group.full_path || group.slug) === slug,
    )
  }, [newGroupSlug, topLevelGroups, isGlobalImport, targetMode])

  const existingRepoCount = useMemo(
    () => remoteRepos.filter((repo) => repo.already_exists).length,
    [remoteRepos],
  )

  const { data: members = [] } = useQuery({
    queryKey: ['org-members', activeOrgPath],
    queryFn: () => api.listOrganizationMembers(token!, activeOrgPath),
    enabled: Boolean(token && activeOrgPath),
  })

  const canManage = useMemo(() => {
    if (isGlobalImport && targetMode === 'new' && !createdOrgPath) return true
    const role = members.find((member) => member.user.id === user?.id)?.role
    return role === 'owner' || role === 'admin'
  }, [isGlobalImport, targetMode, createdOrgPath, members, user?.id])

  const { data: credentials = [] } = useQuery({
    queryKey: ['import-credentials', activeOrgPath],
    queryFn: () => api.listImportCredentials(token!, activeOrgPath),
    enabled: Boolean(token && activeOrgPath && canManage),
  })

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
    if (!isGlobalImport || slugTouched || !namespacePath) return
    const ns = namespaces.find((item) => item.path === namespacePath)
    const segment = namespacePath.split('/').pop() ?? namespacePath
    const label = ns?.name ?? segment
    setNewGroupName(label)
    setNewGroupSlug(slugify(segment))
  }, [isGlobalImport, namespacePath, namespaces, slugTouched])

  const ensureTargetOrg = useCallback(async (): Promise<string> => {
    if (!isGlobalImport) {
      if (!routeOrgPath) throw new Error('No target group')
      return routeOrgPath
    }
    if (targetMode === 'existing') {
      if (!existingTargetPath) throw new Error('Select a target group')
      return existingTargetPath
    }
    if (createdOrgPath) return createdOrgPath

    const name = newGroupName.trim()
    const slug = newGroupSlug.trim()
    if (!name || !slug) {
      throw new Error('Enter a group name and URL segment before connecting')
    }

    const existing = topLevelGroups.find(
      (group) => group.slug === slug || (group.full_path || group.slug) === slug,
    )
    if (existing) {
      const path = existing.full_path || existing.slug
      setCreatedOrgPath(path)
      return path
    }

    try {
      const group = await api.createOrganization(token!, {
        name,
        slug,
      })
      const path = group.full_path || group.slug
      setCreatedOrgPath(path)
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      return path
    } catch (err) {
      const message = (err as Error).message.toLowerCase()
      if (message.includes('already exists') || message.includes('conflict')) {
        const fallback = topLevelGroups.find(
          (group) => group.slug === slug || (group.full_path || group.slug) === slug,
        )
        if (fallback) {
          const path = fallback.full_path || fallback.slug
          setCreatedOrgPath(path)
          return path
        }
      }
      throw err
    }
  }, [
    isGlobalImport,
    routeOrgPath,
    targetMode,
    existingTargetPath,
    createdOrgPath,
    newGroupName,
    newGroupSlug,
    token,
    queryClient,
    topLevelGroups,
  ])

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
      const org = await ensureTargetOrg()
      if (pat.trim()) {
        const saved = await api.saveImportCredential(token!, org, {
          provider,
          token: pat,
          base_url: baseUrl.trim() || undefined,
        })
        setCredentialId(saved.id)
        queryClient.invalidateQueries({ queryKey: ['import-credentials', org] })
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
    setAccount(null)
    setRemoteRepos([])
    setNamespaces([])
    setNamespacePath('')
    setSelected({})
    setActiveJobId(null)
    setCreatedOrgPath('')
  }, [isGlobalImport, targetMode, existingTargetPath])

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

  const connectStep = isGlobalImport ? 2 : 1
  const selectStep = isGlobalImport ? 3 : 2

  const breadcrumbItems = isGlobalImport
    ? [{ label: 'Groups', to: '/groups' }, { label: 'Import' }]
    : [...groupBreadcrumbItems(routeOrgPath, groups), { label: 'Import' }]

  const targetPreview =
    isGlobalImport && targetMode === 'new'
      ? newGroupSlug.trim() || 'your-group'
      : activeOrgPath || routeOrgPath

  if (!isGlobalImport && !canManage && members.length > 0) {
    return <Navigate to={`/groups/${routeOrgPath}`} replace />
  }

  const existingTargetForbidden =
    isGlobalImport &&
    targetMode === 'existing' &&
    Boolean(existingTargetPath) &&
    members.length > 0 &&
    !canManage

  return (
    <>
      <Breadcrumbs items={breadcrumbItems} />
      <PageHeader
        title="Import repositories"
        subtitle={
          isGlobalImport
            ? 'Create a new group and mirror projects from GitHub or GitLab in one step.'
            : 'Mirror projects from GitHub or GitLab into this group. Git history is preserved; optionally import issues and open pull/merge requests.'
        }
      />

      {isGlobalImport && (
        <Card className="mb-4">
          <h2 className="text-sm font-semibold text-text mb-3">1. Target group</h2>
          <div className="space-y-4">
            <RadioGroup label="Import into" row>
              <Radio
                name="import-target-mode"
                value="new"
                label="Create a new group"
                checked={targetMode === 'new'}
                onChange={() => setTargetMode('new')}
              />
              <Radio
                name="import-target-mode"
                value="existing"
                label="An existing group"
                checked={targetMode === 'existing'}
                onChange={() => setTargetMode('existing')}
              />
            </RadioGroup>

            {targetMode === 'new' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-text">
                  Group name
                  <input
                    className={`${fieldClass} mt-1`}
                    value={newGroupName}
                    disabled={Boolean(createdOrgPath)}
                    placeholder="My team"
                    onChange={(event) => {
                      const value = event.target.value
                      setNewGroupName(value)
                      if (!slugTouched) setNewGroupSlug(slugify(value))
                    }}
                  />
                </label>
                <label className="block text-sm font-medium text-text">
                  URL segment
                  <input
                    className={`${fieldClass} mt-1 font-mono`}
                    value={newGroupSlug}
                    disabled={Boolean(createdOrgPath)}
                    placeholder="my-team"
                    onChange={(event) => {
                      setSlugTouched(true)
                      setNewGroupSlug(event.target.value)
                    }}
                  />
                  <span className="text-xs text-text-secondary mt-1 block font-mono">
                    pertisk-gits/{targetPreview}
                  </span>
                </label>
              </div>
            )}

            {targetMode === 'existing' && (
              <>
                <Select
                  label="Group"
                  value={existingTargetPath}
                  onChange={(event) => setExistingTargetPath(event.target.value)}
                >
                  <option value="">Select a group…</option>
                  {topLevelGroups.map((group) => (
                    <option key={group.id} value={group.full_path || group.slug}>
                      {group.name} ({group.full_path || group.slug})
                    </option>
                  ))}
                </Select>
                {existingTargetForbidden && (
                  <p className="text-sm text-dashboard-danger">
                    You must be an owner or admin of this group to import repositories.
                  </p>
                )}
              </>
            )}

            {conflictingGroup && (
              <p className="text-sm text-text-secondary">
                Group{' '}
                <span className="font-mono text-text">{conflictingGroup.full_path || conflictingGroup.slug}</span>{' '}
                already exists — import will use that group.
              </p>
            )}

            {createdOrgPath && (
              <p className="text-sm text-text-secondary">
                Group{' '}
                <Link to={`/groups/${createdOrgPath}`} className="font-mono text-primary hover:underline">
                  {createdOrgPath}
                </Link>{' '}
                is ready. Continue below to list and import repositories.
              </p>
            )}
          </div>
        </Card>
      )}

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
              </Select>

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

              {credentials.length > 0 && (
                <Select
                  label="Saved credential"
                  value={credentialId ?? ''}
                  onChange={(event) => setCredentialId(event.target.value || null)}
                >
                  <option value="">Use new token below</option>
                  {credentials.map((cred) => (
                    <option key={cred.id} value={cred.id}>
                      {cred.label ?? cred.provider}
                    </option>
                  ))}
                </Select>
              )}

              <label className="block text-sm font-medium text-text">
                Personal access token
                <input
                  type="password"
                  className={`${fieldClass} mt-1 font-mono`}
                  placeholder={provider === 'github' ? 'ghp_…' : 'glpat-…'}
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
                    : 'Needs read_api and read_repository scopes. Stored encrypted; never shown again.'}
                </span>
              </label>

              {discover.error && (
                <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
                  {(discover.error as Error).message}
                </div>
              )}

              <PrimaryButton
                type="button"
                disabled={discover.isPending || existingTargetForbidden}
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
            </form>
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-text mb-3">{selectStep}. Select repositories</h2>
          {remoteRepos.length === 0 && (
            <p className="text-sm text-text-secondary">
              {isGlobalImport
                ? 'Set a target group and connect with a token to see repositories you can import.'
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
          {namespaces.length > 0 && (
            <div className="mb-3">
              <Select
                label={provider === 'github' ? 'Organization' : 'Group'}
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
                <option value="override">Re-import (update mirror and metadata)</option>
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
