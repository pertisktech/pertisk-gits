import { useQuery } from '@tanstack/react-query'
import { FolderGit2, Plus } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { StatusBadge, visibilityVariant } from '../components/StatusBadge'
import { EmptyState, LinkButton } from '../components/ui'

export function GroupDetailPage() {
  const { slug = '' } = useParams()
  const { token } = useAuth()

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })
  const group = groups.find((g) => g.slug === slug)

  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['repositories', slug],
    queryFn: () => api.listRepositories(token!, slug),
    enabled: Boolean(token && slug),
  })

  return (
    <>
      <div className="app-repo-header mb-4">
        <h1 className="app-repo-title">
          <span>{group?.name ?? slug}</span>
        </h1>
        {group?.description && <p className="app-repo-desc">{group.description}</p>}
        <p className="text-xs text-muted font-mono mt-1">@{slug}</p>
      </div>

      <div className="mb-4 flex justify-end">
        <LinkButton to={`/groups/${slug}/projects/new`} primary>
          <Plus size={14} />
          New repository
        </LinkButton>
      </div>

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
              <LinkButton to={`/groups/${slug}/projects/new`} primary>
                New repository
              </LinkButton>
            }
          />
        )}

        {!isLoading && projects.length > 0 && (
          <table className="app-list-table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Visibility</th>
                <th>Branch</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <Link
                      to={`/groups/${slug}/projects/${project.slug}`}
                      className="font-medium text-text hover:text-primary font-mono text-sm"
                    >
                      {project.name}
                    </Link>
                    <div className="text-xs text-muted font-mono mt-0.5">
                      {slug}/{project.slug}
                    </div>
                    {project.description && (
                      <div className="text-xs text-text-secondary mt-1">{project.description}</div>
                    )}
                  </td>
                  <td>
                    <StatusBadge variant={visibilityVariant(project.visibility)}>
                      {project.visibility}
                    </StatusBadge>
                  </td>
                  <td className="font-mono text-sm text-text-secondary">{project.default_branch}</td>
                  <td className="text-sm text-text-secondary">
                    {new Date(project.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
