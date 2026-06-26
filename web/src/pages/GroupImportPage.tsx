import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ImportJobDetail, ImportProvider, RemoteNamespace, RemoteRepo } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { StatusBadge } from '../components/StatusBadge'
import { Card } from '../components/Card'
import {
  Alert,
  Breadcrumbs,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
} from '../components/ui'
import { CheckboxField, FieldLabel, Input, Select } from '../components/ui/Input'
import { formatDateTime } from '../lib/collaboration'

function jobStatusVariant(status: string) {
  if (status === 'done') return 'green' as const
  if (status === 'failed') return 'red' as const
  if (status === 'pending') return 'gray' as const
  if (status === 'metadata') return 'violet' as const
  return 'yellow' as const
}

export function GroupImportPage() {
  const { slug = '' } = useParams()
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
    queryKey: ['org-members', slug],
    queryFn: () => api.listOrganizationMembers(token!, slug),
    enabled: Boolean(token && slug),
  })

  const canManage = useMemo(() => {
    const role = members.find((member) => member.user.id === user?.id)?.role
    return role === 'owner' || role === 'admin'
  }, [members, user?.id])

  const { data: credentials = [] } = useQuery({
    queryKey: ['import-credentials', slug],
    queryFn: () => api.listImportCredentials(token!, slug),
    enabled: Boolean(token && slug && canManage),
  })

  const { data: jobs = [] } = useQuery({
    queryKey: ['import-jobs', slug],
    queryFn: () => api.listImportJobs(token!, slug),
    enabled: Boolean(token && slug && canManage),
    refetchInterval: activeJobId ? 3000 : false,
  })

  const { data: activeJob } = useQuery({
    queryKey: ['import-job', slug, activeJobId],
    queryFn: () => api.getImportJob(token!, slug, activeJobId!),
    enabled: Boolean(token && slug && activeJobId),
    refetchInterval: (query) => {
      const job = query.state.data as ImportJobDetail | undefined
      if (!job) return 3000
      return job.status === 'done' || job.status === 'failed' ? false : 3000
    },
  })

  useEffect(() => {
    if (!activeJob) return
    if (activeJob.status === 'done' || activeJob.status === 'failed') {
      queryClient.invalidateQueries({ queryKey: ['repositories', slug] })
      queryClient.invalidateQueries({ queryKey: ['import-jobs', slug] })
    }
  }, [activeJob, queryClient, slug])

  const saveCredential = useMutation({
    mutationFn: () =>
      api.saveImportCredential(token!, slug, {
        provider,
        token: pat,
        base_url: baseUrl.trim() || undefined,
      }),
    onSuccess: (saved) => {
      setCredentialId(saved.id)
      queryClient.invalidateQueries({ queryKey: ['import-credentials', slug] })
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
        const saved = await api.saveImportCredential(token!, slug, {
          provider,
          token: pat,
          base_url: baseUrl.trim() || undefined,
        })
        setCredentialId(saved.id)
        queryClient.invalidateQueries({ queryKey: ['import-credentials', slug] })
        return api.discoverImportRepos(token!, slug, {
          ...discoverPayload,
          credential_id: saved.id,
        })
      }
      if (!credentialId) {
        throw new Error('Enter a personal access token or select a saved credential')
      }
      return api.discoverImportRepos(token!, slug, discoverPayload)
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
      return api.discoverImportRepos(token!, slug, discoverPayload)
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
      return api.createImportJob(token!, slug, {
        credential_id: id,
        import_issues: importIssues,
        import_pull_requests: importPullRequests,
        repos,
      })
    },
    onSuccess: (job) => {
      setActiveJobId(job.id)
      queryClient.invalidateQueries({ queryKey: ['import-jobs', slug] })
    },
  })

  useEffect(() => {
    if (!credentialId || !account) return
    refreshRepos.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when namespace filter changes
  }, [namespacePath])

  const selectedCount = Object.values(selected).filter(Boolean).length

  if (!canManage && members.length > 0) {
    return <Navigate to={`/groups/${slug}`} replace />
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: slug, to: `/groups/${slug}` },
          { label: 'Import' },
        ]}
      />
      <PageHeader
        title="Import repositories"
        subtitle="Mirror projects from GitHub or GitLab into this group. Git history is preserved; optionally import issues and open pull/merge requests."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="1. Connect">
          <form autoComplete="off" onSubmit={(e) => e.preventDefault()} className="space-y-4">
            <FieldLabel label="Source">
              <Select
                value={provider}
                onChange={(e) => setProvider(e.target.value as ImportProvider)}
                autoComplete="off"
              >
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
              </Select>
            </FieldLabel>

            {provider === 'gitlab' && (
              <FieldLabel label="GitLab URL (optional)">
                <Input
                  className="font-mono"
                  placeholder="https://gitlab.com"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  name="pertisk-import-gitlab-url"
                  autoComplete="off"
                  readOnly
                  onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
                />
              </FieldLabel>
            )}

            {provider === 'github' && (
              <FieldLabel
                label="GitHub URL (optional)"
                hint="Leave blank for github.com. For GitHub Enterprise Server, use your instance URL (e.g. https://github.mycompany.com)."
              >
                <Input
                  className="font-mono"
                  placeholder="https://github.com"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  name="pertisk-import-github-url"
                  autoComplete="off"
                  readOnly
                  onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
                />
              </FieldLabel>
            )}

            {credentials.length > 0 && (
              <FieldLabel label="Saved credential">
                <Select
                  value={credentialId ?? ''}
                  onChange={(e) => setCredentialId(e.target.value || null)}
                >
                  <option value="">Use new token below</option>
                  {credentials.map((cred) => (
                    <option key={cred.id} value={cred.id}>
                      {cred.label ?? cred.provider}
                    </option>
                  ))}
                </Select>
              </FieldLabel>
            )}

            <FieldLabel
              label="Personal access token"
              hint={
                provider === 'github'
                  ? 'Classic PAT: enable repo + read:org scopes. Fine-grained PAT: read Contents and Metadata for target repositories.'
                  : 'Needs read_api and read_repository scopes. Stored encrypted; never shown again.'
              }
            >
              <Input
                type="password"
                className="font-mono"
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
            </FieldLabel>

            {(discover.error || saveCredential.error) && (
              <Alert>{((discover.error ?? saveCredential.error) as Error).message}</Alert>
            )}

            <PrimaryButton type="button" disabled={discover.isPending} onClick={() => discover.mutate()}>
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
        </Card>

        <Card title="2. Select repositories">
          {remoteRepos.length === 0 && (
            <p className="text-theme-sm text-gray-500 dark:text-gray-400">
              Connect with a token to see repositories you can import.
            </p>
          )}
          {account && (
            <p className="mb-4 text-theme-xs text-gray-500 dark:text-gray-400">
              Signed in as <span className="font-mono text-gray-700 dark:text-gray-300">{account}</span>{' '}
              · {remoteRepos.length} repositories
              {namespacePath ? (
                <>
                  {' '}
                  in <span className="font-mono">{namespacePath}</span>
                </>
              ) : null}
            </p>
          )}
          {namespaces.length > 0 && (
            <div className="mb-4 space-y-2">
              <FieldLabel label={provider === 'github' ? 'Organization' : 'Group'}>
                <Select
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
                </Select>
              </FieldLabel>
              {credentialId && (
                <SecondaryButton
                  type="button"
                  disabled={refreshRepos.isPending}
                  onClick={() => refreshRepos.mutate()}
                >
                  {refreshRepos.isPending ? 'Refreshing…' : 'Refresh list'}
                </SecondaryButton>
              )}
            </div>
          )}
          {refreshRepos.error && <Alert className="mb-4">{(refreshRepos.error as Error).message}</Alert>}
          {remoteRepos.length > 0 && (
            <div className="space-y-4">
              <CheckboxField
                label="Import issues, labels, and milestones (open and closed)"
                checked={importIssues}
                onChange={setImportIssues}
              />
              <CheckboxField
                label="Import open pull/merge requests (title, body, branches)"
                checked={importPullRequests}
                onChange={setImportPullRequests}
              />
              <div className="flex flex-wrap items-center gap-2">
                <SecondaryButton
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = {}
                    for (const repo of remoteRepos) next[repo.id] = true
                    setSelected(next)
                  }}
                >
                  Select all
                </SecondaryButton>
                <SecondaryButton
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = {}
                    for (const repo of remoteRepos) next[repo.id] = false
                    setSelected(next)
                  }}
                >
                  Clear
                </SecondaryButton>
                {remoteRepos.length > 200 && (
                  <span className="text-theme-xs text-error-500">
                    This list has {remoteRepos.length} repos; import at most 200 per job.
                  </span>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-200 dark:border-gray-800 dark:divide-gray-800">
                {remoteRepos.map((repo) => (
                  <label
                    key={repo.id}
                    className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500/30 dark:border-gray-600"
                      checked={Boolean(selected[repo.id])}
                      onChange={(e) =>
                        setSelected((prev) => ({ ...prev, [repo.id]: e.target.checked }))
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-theme-sm text-gray-800 dark:text-white/90">
                        {repo.full_name}
                      </span>
                      {repo.description && (
                        <span className="line-clamp-2 text-theme-xs text-gray-500 dark:text-gray-400">
                          {repo.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>

              {startImport.error && <Alert>{(startImport.error as Error).message}</Alert>}

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
        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <Download size={16} />
              Import jobs
            </span>
          }
        >
          {activeJob && (
            <div className="shell-detail-panel">
              <div className="shell-detail-panel-header">
                <span className="shell-detail-panel-meta">{activeJob.id}</span>
                <StatusBadge variant={jobStatusVariant(activeJob.status)}>{activeJob.status}</StatusBadge>
              </div>
              {activeJob.error_message && (
                <p className="shell-detail-panel-error">{activeJob.error_message}</p>
              )}
              <div className="overflow-x-auto">
                <table className="shell-table w-full">
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
                        <td className="font-mono text-theme-xs">{repo.source_full_name}</td>
                        <td>
                          {repo.repository_id ? (
                            <Link
                              to={`/groups/${slug}/projects/${repo.target_slug}`}
                              className="shell-link text-theme-xs"
                            >
                              {slug}/{repo.target_slug}
                            </Link>
                          ) : (
                            <span className="font-mono text-theme-xs text-[var(--shell-text-secondary)]">
                              {slug}/{repo.target_slug}
                            </span>
                          )}
                        </td>
                        <td>
                          <StatusBadge variant={jobStatusVariant(repo.status)}>{repo.status}</StatusBadge>
                          {repo.error_message && (
                            <div className="mt-1 text-theme-xs text-error-500">{repo.error_message}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {jobs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="shell-table w-full">
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
                    <tr
                      key={job.id}
                      className={job.id === activeJobId ? 'bg-[color-mix(in_srgb,var(--shell-menu-active-bg)_55%,transparent)]' : undefined}
                    >
                      <td className="text-theme-sm">{formatDateTime(job.created_at)}</td>
                      <td className="capitalize">{job.provider}</td>
                      <td>
                        <StatusBadge variant={jobStatusVariant(job.status)}>{job.status}</StatusBadge>
                      </td>
                      <td className="text-right">
                        <SecondaryButton type="button" onClick={() => setActiveJobId(job.id)}>
                          View
                        </SecondaryButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
