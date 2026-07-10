import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useProjectParams } from '../hooks/useProjectParams'
import { RepoBranches } from '../components/RepoBranches'
import { RepoBrowser } from '../components/RepoBrowser'
import { RepoCloneDropdown } from '../components/RepoCloneDropdown'
import { RepoCommits } from '../components/RepoCommits'
import { RepoTags } from '../components/RepoTags'
import { RepoIssues } from '../components/RepoIssues'
import { RepoPullRequests } from '../components/RepoPullRequests'
import { RepoPipelines } from '../components/RepoPipelines'
import { RepoWiki } from '../components/RepoWiki'
import { RepoHeader } from '../components/RepoHeader'
import { RepoCompare } from '../components/RepoCompare'
import { RegistryPage } from './RegistryPage'
import { RepoSettings } from '../components/RepoSettings'
import { Breadcrumbs } from '../components/ui'
import { useProjectNav } from '../hooks/useProjectNav'
import type { ProjectTab } from '../lib/projectRoute'
import { projectTabPath } from '../lib/projectRoute'
import { projectBreadcrumbItems } from '../lib/groupRoute'
import { displayRepoName } from '../lib/projectInitial'

export function ProjectDetailPage() {
  const { orgSlug, projectSlug } = useProjectParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { token, user } = useAuth()
  const projectNav = useProjectNav()
  const basePath = `/groups/${orgSlug}/projects/${projectSlug}`

  const tab: ProjectTab = projectNav?.tab ?? 'code'

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

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

  useEffect(() => {
    const requested = searchParams.get('tab')
    if (!requested || requested === 'code') return
    if (requested === 'clone') {
      navigate(basePath, { replace: true })
      return
    }

    const legacyTabs: ProjectTab[] = [
      'compare',
      'issues',
      'pulls',
      'commits',
      'branches',
      'tags',
      'registry',
      'pipelines',
      'wiki',
      'settings',
    ]
    if (!legacyTabs.includes(requested as ProjectTab)) {
      navigate(basePath, { replace: true })
      return
    }

    const tab = requested as ProjectTab
    if (tab === 'settings' && !token) {
      navigate(basePath, { replace: true })
      return
    }

    navigate(projectTabPath(basePath, tab), { replace: true })
  }, [searchParams, token, navigate, basePath])

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
      <Breadcrumbs
        items={projectBreadcrumbItems({
          orgPath: orgSlug,
          groups,
          projectName: displayRepoName(project.name, project.slug),
        })}
      />

      <RepoHeader
        orgPath={orgSlug}
        repoName={project.name}
        repoSlug={project.slug}
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
              cloneUrl={cloneUrl}
              authCloneUrl={authCloneUrl}
              cloneUrlSsh={cloneUrlSsh}
              isPrivate={project.visibility === 'private'}
            />
        )}

        {tab === 'compare' && (
          <RepoCompare
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

        {tab === 'branches' && (
          <RepoBranches
            token={token}
            orgSlug={orgSlug}
            repoSlug={projectSlug}
            defaultBranch={project.default_branch}
          />
        )}

        {tab === 'tags' && (
          <RepoTags
            token={token}
            orgSlug={orgSlug}
            repoSlug={projectSlug}
            defaultBranch={project.default_branch}
          />
        )}

        {tab === 'registry' && token && <RegistryPage />}

        {tab === 'pipelines' && token && (
          <RepoPipelines
            token={token}
            orgSlug={orgSlug}
            repoSlug={projectSlug}
            defaultBranch={project.default_branch}
          />
        )}

        {tab === 'wiki' && (
          <RepoWiki token={token} orgSlug={orgSlug} repoSlug={projectSlug} />
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
