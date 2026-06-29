import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderGit2, FolderTree, Plus, Settings, Download } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { ProjectListRow } from '../components/ProjectListRow'
import listStyles from '../components/ProjectList.module.css'
import { Breadcrumbs, EmptyState, LinkButton } from '../components/ui'
import { useGroupFromRoute } from '../hooks/useGroupFromRoute'
import { useDashboardProjectStats } from '../hooks/useDashboardProjectStats'
import { groupBaseUrl } from '../lib/groupPath'
import { groupBreadcrumbItems } from '../lib/groupRoute'

export function GroupDetailPage() {
  const { token, user } = useAuth()
  const { orgPath, group } = useGroupFromRoute()

  const { data: members = [] } = useQuery({
    queryKey: ['org-members', orgPath],
    queryFn: () => api.listOrganizationMembers(token!, orgPath),
    enabled: Boolean(token && orgPath),
  })

  const { data: subgroups = [], isLoading: subgroupsLoading } = useQuery({
    queryKey: ['subgroups', orgPath],
    queryFn: () => api.listSubgroups(token!, orgPath),
    enabled: Boolean(token && orgPath),
  })

  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['repositories', orgPath],
    queryFn: () => api.listRepositories(token!, orgPath),
    enabled: Boolean(token && orgPath),
  })

  const canManage =
    members.find((member) => member.user.id === user?.id)?.role === 'owner' ||
    members.find((member) => member.user.id === user?.id)?.role === 'admin'

  const projectRefs = useMemo(
    () => projects.map((project) => ({ orgSlug: orgPath, slug: project.slug })),
    [projects, orgPath],
  )
  const { getStats, isLoading: statsLoading } = useDashboardProjectStats(projectRefs)

  const basePath = `/groups/${orgPath}`

  return (
    <>
      <Breadcrumbs
        items={groupBreadcrumbItems(orgPath).map((item, i, arr) =>
          i === arr.length - 1 ? { label: group?.name ?? item.label } : item,
        )}
      />

      <div className="app-repo-header mb-4">
        <h1 className="app-repo-title">
          <span>{group?.name ?? orgPath}</span>
        </h1>
        {group?.description && <p className="app-repo-desc">{group.description}</p>}
        <p className="text-xs text-muted font-mono mt-1">@{orgPath}</p>
      </div>

      <div className="mb-4 flex justify-end gap-2">
        {canManage && (
          <LinkButton to={`${basePath}/settings`}>
            <Settings size={14} />
            Settings
          </LinkButton>
        )}
        {canManage && (
          <LinkButton to={`${basePath}/import`}>
            <Download size={14} />
            Import
          </LinkButton>
        )}
        {canManage && (
          <LinkButton to={`/groups/new?parent=${encodeURIComponent(orgPath)}`}>
            <Plus size={14} />
            New subgroup
          </LinkButton>
        )}
        <LinkButton to={`${basePath}/projects/new`} primary>
          <Plus size={14} />
          New repository
        </LinkButton>
      </div>

      {(subgroups.length > 0 || subgroupsLoading) && (
        <div className="app-panel mb-4">
          <div className="app-panel-header flex items-center justify-between">
            <span>Subgroups</span>
            <span className="font-normal text-text-secondary">{subgroups.length}</span>
          </div>
          {subgroupsLoading && (
            <div className="p-6 text-center text-text-secondary text-sm">Loading…</div>
          )}
          {!subgroupsLoading && subgroups.length > 0 && (
            <table className="app-list-table">
              <thead>
                <tr>
                  <th>Subgroup</th>
                  <th>Path</th>
                </tr>
              </thead>
              <tbody>
                {subgroups.map((sub) => (
                  <tr key={sub.id}>
                    <td>
                      <Link
                        to={groupBaseUrl(sub)}
                        className="font-medium text-text hover:text-primary text-sm inline-flex items-center gap-1.5"
                      >
                        <FolderTree size={14} className="text-muted" />
                        {sub.name}
                      </Link>
                    </td>
                    <td className="font-mono text-xs text-text-secondary">{sub.full_path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="app-panel">
        <div className="app-panel-header flex items-center justify-between">
          <span>Repositories</span>
          <span className="font-normal text-text-secondary">{projects.length}</span>
        </div>

        {isLoading && <div className="p-8 text-center text-text-secondary text-sm">Loading…</div>}
        {error && (
          <div className="m-4 p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {(error as Error).message}
          </div>
        )}

        {!isLoading && projects.length === 0 && (
          <EmptyState
            icon={<FolderGit2 size={40} />}
            title="No repositories"
            description="Create a repository in this group."
            action={
              <LinkButton to={`${basePath}/projects/new`} primary>
                New repository
              </LinkButton>
            }
          />
        )}

        {!isLoading && projects.length > 0 && (
          <ul className={listStyles.list}>
            {projects.map((project) => (
              <ProjectListRow
                key={project.id}
                orgSlug={orgPath}
                slug={project.slug}
                name={project.name}
                updatedAt={project.updated_at}
                stats={getStats({ orgSlug: orgPath, slug: project.slug })}
                statsLoading={statsLoading}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
