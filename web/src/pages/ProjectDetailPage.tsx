import { useQuery } from '@tanstack/react-query'
import { Check, Copy, FolderGit2, GitBranch, Lock } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Card } from '../components/Card'
import { StatusBadge, visibilityVariant } from '../components/StatusBadge'
import { Breadcrumbs, PageHeader } from '../components/ui'

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <div className="text-sm font-semibold text-text mb-1.5">{label}</div>
      <div className="flex gap-2">
        <code className="flex-1 px-3 py-2 rounded-lg border border-border bg-bg font-mono text-xs text-text break-all">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-text-secondary hover:bg-hover text-sm shrink-0"
          data-no-global-button-hover="true"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

export function ProjectDetailPage() {
  const { slug: orgSlug = '', projectSlug = '' } = useParams()
  const { token, user } = useAuth()

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })
  const group = groups.find((g) => g.slug === orgSlug)

  const { data, isLoading, error } = useQuery({
    queryKey: ['repository', orgSlug, projectSlug],
    queryFn: () => api.getRepository(token!, orgSlug, projectSlug),
    enabled: Boolean(token && orgSlug && projectSlug),
  })

  const project = data?.repository
  const cloneUrl = data?.clone_url_http ?? ''
  const authCloneUrl = user ? cloneUrl.replace('://', `://${user.username}@`) : cloneUrl

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: group?.name ?? orgSlug, to: `/groups/${orgSlug}` },
          { label: project?.name ?? projectSlug },
        ]}
      />

      <PageHeader
        title={project?.name ?? projectSlug}
        subtitle={
          project ? (
            <span className="inline-flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm">
                {orgSlug}/{projectSlug}
              </span>
              <StatusBadge variant={visibilityVariant(project.visibility)}>{project.visibility}</StatusBadge>
            </span>
          ) : undefined
        }
      />

      {isLoading && <div className="text-text-secondary">Loading project…</div>}
      {error && (
        <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {(error as Error).message}
        </div>
      )}

      {project && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Project information">
            <p className="text-text-secondary mb-4">{project.description ?? 'No description provided.'}</p>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-text-secondary font-medium">Default branch</dt>
                <dd className="text-text font-mono flex items-center gap-1.5 mt-0.5">
                  <GitBranch size={14} className="text-primary" />
                  {project.default_branch}
                </dd>
              </div>
              <div>
                <dt className="text-text-secondary font-medium">Created</dt>
                <dd className="text-text mt-0.5">{new Date(project.created_at).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-text-secondary font-medium">Last updated</dt>
                <dd className="text-text mt-0.5">{new Date(project.updated_at).toLocaleString()}</dd>
              </div>
            </dl>
          </Card>

          <Card title="Clone">
            <div className="space-y-4">
              <CopyField label="HTTP clone URL" value={cloneUrl} />
              {project.visibility === 'private' && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-dashboard-info-bg border border-blue-b1/20 text-sm text-text-secondary">
                  <Lock size={14} className="text-blue-b1 shrink-0 mt-0.5" />
                  Private project — use your username and password when Git prompts for credentials.
                </div>
              )}
            </div>
          </Card>

          <Card title="Push an existing folder" className="lg:col-span-2">
            <pre className="m-0 p-4 rounded-lg bg-bg border border-border font-mono text-xs text-text overflow-x-auto leading-relaxed">{`cd my-project
git init --initial-branch=${project.default_branch}
git remote add origin ${authCloneUrl}
git add .
git commit -m "Initial commit"
git push -u origin ${project.default_branch}`}</pre>
            <p className="text-sm text-text-secondary mt-3">
              Use your Pertisk Gits account password when Git prompts for credentials.
            </p>
          </Card>

          <Card title="Clone this repository" className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-3 text-text-secondary">
              <FolderGit2 size={16} />
              <span className="text-sm">Quick start</span>
            </div>
            <pre className="m-0 p-4 rounded-lg bg-bg border border-border font-mono text-xs text-text overflow-x-auto">
              {`git clone ${cloneUrl}`}
            </pre>
          </Card>
        </div>
      )}
    </>
  )
}
