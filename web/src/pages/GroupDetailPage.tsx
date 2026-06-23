import { useQuery } from '@tanstack/react-query'
import { FolderGit2, Plus } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { StatusBadge, visibilityVariant } from '../components/StatusBadge'
import { Breadcrumbs, EmptyState, LinkButton, PageHeader } from '../components/ui'

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
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: group?.name ?? slug },
        ]}
      />
      <PageHeader
        title={group?.name ?? slug}
        subtitle={group?.description ?? 'Group projects and repositories'}
        action={
          <LinkButton to={`/groups/${slug}/projects/new`} primary>
            <Plus size={14} />
            New project
          </LinkButton>
        }
      />

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text">Projects</h2>
          <span className="text-sm text-text-secondary">{projects.length} repositories</span>
        </div>

        {isLoading && <div className="p-8 text-center text-text-secondary">Loading projects…</div>}
        {error && (
          <div className="m-4 p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {(error as Error).message}
          </div>
        )}

        {!isLoading && projects.length === 0 && (
          <EmptyState
            icon={<FolderGit2 size={40} />}
            title="No projects in this group"
            description="Create a project to host Git repositories."
            action={
              <LinkButton to={`/groups/${slug}/projects/new`} primary>
                Create project
              </LinkButton>
            }
          />
        )}

        {!isLoading && projects.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-elevated">
                <th className="px-4 py-2 text-left font-semibold text-text">Project</th>
                <th className="px-4 py-2 text-left font-semibold text-text">Visibility</th>
                <th className="px-4 py-2 text-left font-semibold text-text">Default branch</th>
                <th className="px-4 py-2 text-left font-semibold text-text">Updated</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project, i) => (
                <tr
                  key={project.id}
                  className={`border-b border-border hover:bg-hover cursor-pointer ${i % 2 ? 'bg-surface-elevated' : 'bg-surface'}`}
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/groups/${slug}/projects/${project.slug}`}
                      className="font-medium text-text hover:text-primary"
                    >
                      {project.name}
                    </Link>
                    <div className="text-xs text-text-secondary font-mono">
                      {slug}/{project.slug}
                    </div>
                    {project.description && (
                      <div className="text-xs text-muted mt-1">{project.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge variant={visibilityVariant(project.visibility)}>
                      {project.visibility}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 font-mono text-text-secondary">{project.default_branch}</td>
                  <td className="px-4 py-3 text-text-secondary">
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
