import { useQuery } from '@tanstack/react-query'
import { Code2, FolderGit2, GitCommit, Lock, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { GogsSegment } from '../components/GogsSegment'
import { RepoBrowser } from '../components/RepoBrowser'
import { RepoCommits } from '../components/RepoCommits'
import { RepoHeader } from '../components/RepoHeader'
import { RepoSettings } from '../components/RepoSettings'

type Tab = 'code' | 'commits' | 'clone' | 'settings'

function CloneTabContent({
  cloneUrl,
  authCloneUrl,
  cloneUrlSsh,
  defaultBranch,
  isPrivate,
}: {
  cloneUrl: string
  authCloneUrl: string
  cloneUrlSsh?: string | null
  defaultBranch: string
  isPrivate: boolean
}) {
  return (
    <div className="gogs-panel">
      <div className="gogs-panel-header">Clone this repository</div>
      <div className="gogs-panel-body space-y-5">
        <div>
          <div className="text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wide">
            HTTP
          </div>
          <pre className="m-0 p-3 rounded-md bg-bg border border-border font-mono text-xs text-text overflow-x-auto">
            {`git clone ${cloneUrl}`}
          </pre>
        </div>
        {cloneUrlSsh && (
          <div>
            <div className="text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wide">
              SSH
            </div>
            <pre className="m-0 p-3 rounded-md bg-bg border border-border font-mono text-xs text-text overflow-x-auto">
              {`git clone ${cloneUrlSsh}`}
            </pre>
          </div>
        )}
        <div>
          <div className="text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wide">
            Push an existing project
          </div>
          <pre className="m-0 p-3 rounded-md bg-bg border border-border font-mono text-xs text-text overflow-x-auto leading-relaxed">{`cd my-project
git init --initial-branch=${defaultBranch}
git remote add origin ${authCloneUrl}
git add .
git commit -m "Initial commit"
git push -u origin ${defaultBranch}`}</pre>
        </div>
        {isPrivate && (
          <p className="text-sm text-text-secondary flex items-start gap-2 p-3 rounded-md bg-dashboard-info-bg border border-blue-b1/20">
            <Lock size={14} className="text-blue-b1 shrink-0 mt-0.5" />
            Private repository — use your Pertisk Gits account password when Git prompts.
          </p>
        )}
      </div>
    </div>
  )
}

export function ProjectDetailPage() {
  const { slug: orgSlug = '', projectSlug = '' } = useParams()
  const [searchParams] = useSearchParams()
  const { token, user } = useAuth()
  const [tab, setTab] = useState<Tab>('code')

  useEffect(() => {
    const requested = searchParams.get('tab')
    if (requested === 'commits' || requested === 'clone' || requested === 'settings' || requested === 'code') {
      setTab(requested)
    }
  }, [searchParams])

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
  const cloneUrlSsh = data?.clone_url_ssh ?? null
  const authCloneUrl = user ? cloneUrl.replace('://', `://${user.username}@`) : cloneUrl

  if (isLoading) {
    return <div className="text-text-secondary text-sm py-8">Loading repository…</div>
  }

  if (error) {
    return (
      <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
        {(error as Error).message}
      </div>
    )
  }

  if (!project || !token) return null

  return (
    <>
      <RepoHeader
        orgName={group?.name ?? orgSlug}
        orgSlug={orgSlug}
        repoName={project.name}
        description={project.description}
        visibility={project.visibility}
      />

      <GogsSegment
        active={tab}
        onChange={(id) => setTab(id as Tab)}
        tabs={[
          { id: 'code', label: 'Code', icon: Code2 },
          { id: 'commits', label: 'Commits', icon: GitCommit },
          { id: 'clone', label: 'Clone', icon: FolderGit2 },
          { id: 'settings', label: 'Settings', icon: Settings },
        ]}
      />

      {tab === 'code' && (
        <RepoBrowser
          token={token}
          orgSlug={orgSlug}
          repoSlug={projectSlug}
          defaultBranch={project.default_branch}
        />
      )}

      {tab === 'commits' && (
        <RepoCommits
          token={token}
          orgSlug={orgSlug}
          repoSlug={projectSlug}
          defaultBranch={project.default_branch}
        />
      )}

      {tab === 'clone' && (
        <CloneTabContent
          cloneUrl={cloneUrl}
          authCloneUrl={authCloneUrl}
          cloneUrlSsh={cloneUrlSsh}
          defaultBranch={project.default_branch}
          isPrivate={project.visibility === 'private'}
        />
      )}

      {tab === 'settings' && (
        <RepoSettings
          token={token}
          orgSlug={orgSlug}
          repoSlug={projectSlug}
          project={project}
          branches={[project.default_branch]}
        />
      )}
    </>
  )
}
