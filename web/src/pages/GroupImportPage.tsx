import { useOrgPathParam } from '../hooks/useOrgPathParam'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api } from '../api/client'
import type { ImportJobDetail, ImportProvider, RemoteNamespace, RemoteRepo } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { StatusBadge } from '../components/StatusBadge'
import { Card } from '../components/Card'
import { Breadcrumbs, Checkbox, PageHeader, PrimaryButton, SecondaryButton } from '../components/ui'

const fieldClass =
  'w-full px-3 py-2 rounded-lg border border-naturals-n4 bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

function jobStatusVariant(status: string) {
  if (status === 'done') return 'green' as const
  if (status === 'failed') return 'red' as const
  if (status === 'pending') return 'gray' as const
  if (status === 'metadata') return 'violet' as const
  return 'yellow' as const
}

export function GroupImportPage() {
  const orgPath = useOrgPathParam()
  const { token, user } = useAuth()
  const queryClient = useQueryClient()

  const [provider, setProvider] = useState<ImportProvider>('github')
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
  const [activeJobId, setActiveJobId] = useState<string | null>(null)

  const { data: members = [] } = useQuery({
    queryKey: ['org-members', orgPath],
    queryFn: () => api.listOrganizationMembers(token!, orgPath),
    enabled: Boolean(token && orgPath),
  })

  const canManage = useMemo(() => {
    const role = members.find((member) => member.user.id === user?.id)?.role
    return role === 'owner' || role === 'admin'
  }, [members, user?.id])

  const { data: credentials = [] } = useQuery({
    queryKey: ['import-credentials', orgPath],
    queryFn: () => api.listImportCredentials(token!, orgPath),
    enabled: Boolean(token && orgPath && canManage),
  })

  const { data: jobs = [] } = useQuery({
    queryKey: ['import-jobs', orgPath],
    queryFn: () => api.listImportJobs(token!, orgPath),
    enabled: Boolean(token && orgPath && canManage),
    refetchInterval: activeJobId ? 3000 : false,
  })

  const { data: activeJob } = useQuery({
    queryKey: ['import-job', orgPath, activeJobId],
    queryFn: () => api.getImportJob(token!, orgPath, activeJobId!),
    enabled: Boolean(token && orgPath && activeJobId),
    refetchInterval: (query) => {
      const job = query.state.data as ImportJobDetail | undefined
      if (!job) return 3000
      return job.status === 'done' || job.status === 'failed' ? false : 3000
    },
  })

  useEffect(() => {
    if (!activeJob) return
    if (activeJob.status === 'done' || activeJob.status === 'failed') {
      queryClient.invalidateQueries({ queryKey: ['repositories', orgPath] })
      queryClient.invalidateQueries({ queryKey: ['import-jobs', orgPath] })
    }
  }, [activeJob, queryClient, orgPath])

  const saveCredential = useMutation({
    mutationFn: () =>
      api.saveImportCredential(token!, orgPath, {
        provider,
        token: pat,
        base_url: baseUrl.trim() || undefined,
      }),
    onSuccess: (saved) => {
      setCredentialId(saved.id)
      queryClient.invalidateQueries({ queryKey: ['import-credentials', orgPath] })
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
      if (pat.trim()) {
        const saved = await api.saveImportCredential(token!, orgPath, {
          provider,
          token: pat,
          base_url: baseUrl.trim() || undefined,
        })
        setCredentialId(saved.id)
        queryClient.invalidateQueries({ queryKey: ['import-credentials', orgPath] })
        return api.discoverImportRepos(token!, orgPath, {
          ...discoverPayload,
          credential_id: saved.id,
        })
      }
      if (!credentialId) {
        throw new Error('Enter a personal access token or select a saved credential')
      }
      return api.discoverImportRepos(token!, orgPath, discoverPayload)
    },
    onSuccess: (result) => {
      setAccount(result.account)
      setNamespaces(result.namespaces)
      setRemoteRepos(result.repos)
      const initial: Record<string, boolean> = {}
      for (const repo of result.repos) {
        initial[repo.id] = false
      }
      setSelected(initial)
    },
  })

  const refreshRepos = useMutation({
    mutationFn: () => {
      if (!credentialId) throw new Error('Save credentials before listing repositories')
      return api.discoverImportRepos(token!, orgPath, discoverPayload)
    },
    onSuccess: (result) => {
      setNamespaces(result.namespaces)
      setRemoteRepos(result.repos)
      const initial: Record<string, boolean> = {}
      for (const repo of result.repos) {
        initial[repo.id] = false
      }
      setSelected(initial)
    },
  })

  const startImport = useMutation({
    mutationFn: () => {
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
      return api.createImportJob(token!, orgPath, {
        credential_id: id,
        import_issues: importIssues,
        import_pull_requests: importPullRequests,
        repos,
      })
    },
    onSuccess: (job) => {
      setActiveJobId(job.id)
      queryClient.invalidateQueries({ queryKey: ['import-jobs', orgPath] })
    },
  })

  useEffect(() => {
    if (!credentialId || !account) return
    refreshRepos.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when namespace filter changes
  }, [namespacePath])

  const selectedCount = Object.values(selected).filter(Boolean).length

  if (!canManage && members.length > 0) {
    return <Navigate to={`/groups/${orgPath}`} replace />
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: orgPath, to: `/groups/${orgPath}` },
          { label: 'Import' },
        ]}
      />
      <PageHeader
        title="Import repositories"
        subtitle="Mirror projects from GitHub or GitLab into this group. Git history is preserved; optionally import issues and open pull/merge requests."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-text mb-3">1. Connect</h2>
          <div className="space-y-3">
            <form
              autoComplete="off"
              onSubmit={(e) => e.preventDefault()}
              className="space-y-3"
            >
            <label className="block text-sm font-medium text-text">
              Source
              <select
                className={`${fieldClass} mt-1`}
                value={provider}
                onChange={(e) => setProvider(e.target.value as ImportProvider)}
                autoComplete="off"
              >
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
              </select>
            </label>

            {provider === 'gitlab' && (
              <label className="block text-sm font-medium text-text">
                GitLab URL (optional)
                <input
                  className={`${fieldClass} mt-1 font-mono`}
                  placeholder="https://gitlab.com"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  name="pertisk-import-gitlab-url"
                  autoComplete="off"
                  readOnly
                  onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
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
                  onChange={(e) => setBaseUrl(e.target.value)}
                  name="pertisk-import-github-url"
                  autoComplete="off"
                  readOnly
                  onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
                />
                <span className="text-xs text-text-secondary mt-1 block">
                  Leave blank for github.com. For GitHub Enterprise Server, use your instance URL
                  (e.g. https://github.mycompany.com).
                </span>
              </label>
            )}

            {credentials.length > 0 && (
              <label className="block text-sm font-medium text-text">
                Saved credential
                <select
                  className={`${fieldClass} mt-1`}
                  value={credentialId ?? ''}
                  onChange={(e) => setCredentialId(e.target.value || null)}
                >
                  <option value="">Use new token below</option>
                  {credentials.map((cred) => (
                    <option key={cred.id} value={cred.id}>
                      {cred.label ?? cred.provider}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block text-sm font-medium text-text">
              Personal access token
              <input
                type="password"
                className={`${fieldClass} mt-1 font-mono`}
                placeholder={provider === 'github' ? 'ghp_…' : 'glpat-…'}
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                name="pertisk-import-pat"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                readOnly
                onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
              />
              <span className="text-xs text-text-secondary mt-1 block">
                {provider === 'github'
                  ? 'Classic PAT: enable the repo scope. Fine-grained PAT: grant read access to Contents and Metadata for target repositories.'
                  : 'Needs read_api and read_repository scopes. Stored encrypted; never shown again.'}
              </span>
            </label>

            {(discover.error || saveCredential.error) && (
              <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
                {((discover.error ?? saveCredential.error) as Error).message}
              </div>
            )}

            <PrimaryButton
              type="button"
              disabled={discover.isPending}
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
          <h2 className="text-sm font-semibold text-text mb-3">2. Select repositories</h2>
          {remoteRepos.length === 0 && (
            <p className="text-sm text-text-secondary">
              Connect with a token to see repositories you can import.
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
            </p>
          )}
          {namespaces.length > 0 && (
            <label className="block text-sm font-medium text-text mb-3">
              {provider === 'github' ? 'Organization' : 'Group'}
              <select
                className={`${fieldClass} mt-1`}
                value={namespacePath}
                onChange={(e) => setNamespacePath(e.target.value)}
                disabled={refreshRepos.isPending}
              >
                <option value="">All accessible repositories</option>
                {namespaces.map((ns) => (
                  <option key={ns.id} value={ns.path}>
                    {ns.name}
                  </option>
                ))}
              </select>
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
            </label>
          )}
          {refreshRepos.error && (
            <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm mb-3">
              {(refreshRepos.error as Error).message}
            </div>
          )}
          {remoteRepos.length > 0 && (
            <div className="space-y-3">
              <Checkbox
                row
                label="Import issues, labels, and milestones (open and closed)"
                checked={importIssues}
                onChange={(e) => setImportIssues(e.target.checked)}
              />
              <Checkbox
                row
                label="Import open pull/merge requests (title, body, branches)"
                checked={importPullRequests}
                onChange={(e) => setImportPullRequests(e.target.checked)}
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
                {remoteRepos.length > 200 && (
                  <span className="text-xs text-dashboard-danger">
                    This list has {remoteRepos.length} repos; import at most 200 per job.
                  </span>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto border border-naturals-n4 rounded-lg divide-y divide-naturals-n4">
                {remoteRepos.map((repo) => (
                  <label
                    key={repo.id}
                    className="flex items-start gap-3 px-3 py-2 hover:bg-surface-hover cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={Boolean(selected[repo.id])}
                      onChange={(e) =>
                        setSelected((prev) => ({ ...prev, [repo.id]: e.target.checked }))
                      }
                    />
                    <span className="min-w-0">
                      <span className="font-mono text-sm text-text block truncate">
                        {repo.full_name}
                      </span>
                      {repo.description && (
                        <span className="text-xs text-text-secondary line-clamp-2">
                          {repo.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>

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
                {startImport.isPending ? 'Starting import…' : `Import ${selectedCount} repositories`}
              </PrimaryButton>
            </div>
          )}
        </Card>
      </div>

      {(activeJob || jobs.length > 0) && (
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
                            to={`/groups/${orgPath}/projects/${repo.target_slug}`}
                            className="font-mono text-primary hover:underline"
                          >
                            {orgPath}/{repo.target_slug}
                          </Link>
                        ) : (
                          <span className="font-mono text-text-secondary">
                            {orgPath}/{repo.target_slug}
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
                {jobs.map((job) => (
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
        </Card>
      )}
    </>
  )
}
