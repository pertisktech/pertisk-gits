import { useQuery } from '@tanstack/react-query'
import { Code2, FolderGit2, GitCommit, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { GogsSegment } from '../components/GogsSegment'
import { RepoBrowser } from '../components/RepoBrowser'
import { RepoClonePanel } from '../components/RepoClonePanel'
import { RepoCommits } from '../components/RepoCommits'
import { RepoHeader } from '../components/RepoHeader'
import { RepoSettings } from '../components/RepoSettings'

type Tab = 'code' | 'commits' | 'clone' | 'settings'

export function ProjectDetailPage() {
  const { slug: orgSlug = '', projectSlug = '' } = useParams()
  const [searchParams] = useSearchParams()
  const { token, user } = useAuth()
  const [tab, setTab] = useState<Tab>('code')

  useEffect(() => {
    const requested = searchParams.get('tab')
    if (requested === 'commits' || requested === 'clone' || requested === 'code') {
      setTab(requested)
    } else if (requested === 'settings' && token) {
      setTab('settings')
    }
  }, [searchParams, token])

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })
  const group = groups.find((g) => g.slug === orgSlug)

  const { data, isLoading, error } = useQuery({
    queryKey: ['repository', orgSlug, projectSlug, token ?? 'public'],
    queryFn: () => api.getRepository(orgSlug, projectSlug, token),
    enabled: Boolean(orgSlug && projectSlug),
  })

  const project = data?.repository
  const cloneUrl = data?.clone_url_http ?? ''
  const cloneUrlSsh = data?.clone_url_ssh ?? null
  const authCloneUrl = user ? cloneUrl.replace('://', `://${user.username}@`) : cloneUrl

  const tabs = [
    { id: 'code', label: 'Code', icon: Code2 },
    { id: 'commits', label: 'Commits', icon: GitCommit },
    { id: 'clone', label: 'Clone', icon: FolderGit2 },
    ...(token ? [{ id: 'settings', label: 'Settings', icon: Settings }] : []),
  ]

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

  if (!project) return null

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
        tabs={tabs}
      />

      {tab === 'code' && (
        <RepoBrowser
          token={token}
          orgSlug={orgSlug}
          repoSlug={projectSlug}
          defaultBranch={project.default_branch}
          cloneUrl={cloneUrl}
          authCloneUrl={authCloneUrl}
          cloneUrlSsh={cloneUrlSsh}
          isPrivate={project.visibility === 'private'}
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
        <RepoClonePanel
          cloneUrl={cloneUrl}
          authCloneUrl={authCloneUrl}
          cloneUrlSsh={cloneUrlSsh}
          defaultBranch={project.default_branch}
          isPrivate={project.visibility === 'private'}
        />
      )}

      {tab === 'settings' && token && (
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
