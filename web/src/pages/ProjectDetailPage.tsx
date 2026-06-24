import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { RepoBrowser } from '../components/RepoBrowser'
import { RepoCloneDropdown } from '../components/RepoCloneDropdown'
import { RepoCommits } from '../components/RepoCommits'
import { RepoIssues } from '../components/RepoIssues'
import { RepoPullRequests } from '../components/RepoPullRequests'
import { RepoPipelines, PIPELINE_CONFIG_FILES } from '../components/RepoPipelines'
import { RepoHeader } from '../components/RepoHeader'
import { RepoSettings } from '../components/RepoSettings'
import { useProjectNav } from '../hooks/useProjectNav'
import type { ProjectTab } from '../lib/projectRoute'

export function ProjectDetailPage() {
  const { slug: orgSlug = '', projectSlug = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { token, user } = useAuth()
  const projectNav = useProjectNav()

  const tab: ProjectTab = projectNav?.tab ?? 'code'

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
    if (requested === 'clone') {
      setSearchParams({}, { replace: true })
      return
    }
    if (requested === 'pipelines' && !showPipelinesTab && !pipelineConfigLoading) {
      setSearchParams({}, { replace: true })
    }
    if (requested === 'settings' && !token) {
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, token, showPipelinesTab, pipelineConfigLoading, setSearchParams])

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
