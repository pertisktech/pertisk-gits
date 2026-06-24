import { useQuery } from '@tanstack/react-query'
import { Code2, CircleDot, GitCommit, GitPullRequest, Settings, Workflow } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { GogsSegment } from '../components/GogsSegment'
import { RepoBrowser } from '../components/RepoBrowser'
import { RepoCloneDropdown } from '../components/RepoCloneDropdown'
import { RepoCommits } from '../components/RepoCommits'
import { RepoIssues } from '../components/RepoIssues'
import { RepoPullRequests } from '../components/RepoPullRequests'
import { RepoPipelines, PIPELINE_CONFIG_FILES } from '../components/RepoPipelines'
import { RepoHeader } from '../components/RepoHeader'
import { RepoSettings } from '../components/RepoSettings'

type Tab = 'code' | 'issues' | 'pulls' | 'commits' | 'pipelines' | 'settings'

export function ProjectDetailPage() {
  const { slug: orgSlug = '', projectSlug = '' } = useParams()
  const [searchParams] = useSearchParams()
  const { token, user } = useAuth()
  const [tab, setTab] = useState<Tab>('code')

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

  const { data: browserData } = useQuery({
    queryKey: ['repo-browser', orgSlug, projectSlug],
    queryFn: () => api.getRepoBrowser(orgSlug, projectSlug, token),
    enabled: Boolean(orgSlug && projectSlug),
  })

  const project = data?.repository
  const cloneUrl = data?.clone_url_http ?? ''
  const cloneUrlSsh = data?.clone_url_ssh ?? null
  const authCloneUrl = user ? cloneUrl.replace('://', `://${user.username}@`) : cloneUrl
  const repoEmpty = browserData?.browser.empty ?? false

  const { data: hasPipelineConfig = false, isLoading: pipelineConfigLoading } = useQuery({
    queryKey: ['pipeline-config', orgSlug, projectSlug, project?.default_branch],
    queryFn: async () => {
      const tree = await api.getRepoTree(
        orgSlug,
        projectSlug,
        { ref: project!.default_branch },
        token,
      )
      return tree.entries.some(
        (entry) => PIPELINE_CONFIG_FILES.has(entry.name) && entry.kind === 'blob',
      )
    },
    enabled: Boolean(token && orgSlug && projectSlug && project && browserData && !repoEmpty),
  })

  const showPipelinesTab = Boolean(token && !repoEmpty && hasPipelineConfig)

  useEffect(() => {
    const requested = searchParams.get('tab')
    if (requested === 'commits' || requested === 'code' || requested === 'issues' || requested === 'pulls') {
      setTab(requested)
    } else if (requested === 'pipelines' && showPipelinesTab) {
      setTab('pipelines')
    } else if (requested === 'settings' && token) {
      setTab('settings')
    } else if (requested === 'clone') {
      setTab('code')
    }
  }, [searchParams, token, showPipelinesTab])

  useEffect(() => {
    if (tab === 'pipelines' && !showPipelinesTab && !pipelineConfigLoading) {
      setTab('code')
    }
  }, [tab, showPipelinesTab, pipelineConfigLoading])

  const tabs = [
    { id: 'code', label: 'Code', icon: Code2 },
    { id: 'issues', label: 'Issues', icon: CircleDot },
    { id: 'pulls', label: 'Pull requests', icon: GitPullRequest },
    { id: 'commits', label: 'Commits', icon: GitCommit },
    ...(showPipelinesTab ? [{ id: 'pipelines', label: 'Pipelines', icon: Workflow }] : []),
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
        action={
          <RepoCloneDropdown
            cloneUrl={cloneUrl}
            authCloneUrl={authCloneUrl}
            cloneUrlSsh={cloneUrlSsh}
            defaultBranch={project.default_branch}
            isPrivate={project.visibility === 'private'}
            orgSlug={orgSlug}
            repoSlug={projectSlug}
            token={token}
            empty={repoEmpty}
          />
        }
      />

      <div className="min-w-0 space-y-4">
        {tab === 'code' && (
          <RepoBrowser
            token={token}
            orgSlug={orgSlug}
            repoSlug={projectSlug}
            defaultBranch={project.default_branch}
          />
        )}

        {tab === 'issues' && (
          <RepoIssues token={token} orgSlug={orgSlug} repoSlug={projectSlug} />
        )}

        {tab === 'pulls' && (
          <RepoPullRequests
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

        {tab === 'pipelines' && showPipelinesTab && token && (
          <RepoPipelines
            token={token}
            orgSlug={orgSlug}
            repoSlug={projectSlug}
            defaultBranch={project.default_branch}
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
      </div>
    </>
  )
}
