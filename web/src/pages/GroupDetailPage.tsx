import { useQuery } from '@tanstack/react-query'
import { FolderGit2, Plus, Settings, Download } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { StatusBadge, visibilityVariant } from '../components/StatusBadge'
import { EntityHeader } from '../components/ui/EntityHeader'
import { Alert, Breadcrumbs, EmptyState, LinkButton } from '../components/ui'

export function GroupDetailPage() {
  const { slug = '' } = useParams()
  const { token, user } = useAuth()

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })
  const group = groups.find((g) => g.slug === slug)

  const { data: members = [] } = useQuery({
    queryKey: ['org-members', slug],
    queryFn: () => api.listOrganizationMembers(token!, slug),
    enabled: Boolean(token && slug),
  })

  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['repositories', slug],
    queryFn: () => api.listRepositories(token!, slug),
    enabled: Boolean(token && slug),
  })

  const canManage =
    members.find((member) => member.user.id === user?.id)?.role === 'owner' ||
    members.find((member) => member.user.id === user?.id)?.role === 'admin'

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: group?.name ?? slug },
        ]}
      />

      <EntityHeader
        title={group?.name ?? slug}
        description={group?.description}
        meta={`@${slug}`}
        actions={
          <>
            {canManage && (
              <LinkButton to={`/groups/${slug}/settings`} startIcon={<Settings size={16} />}>
                Settings
              </LinkButton>
            )}
            {canManage && (
              <LinkButton to={`/groups/${slug}/import`} startIcon={<Download size={16} />}>
                Import
              </LinkButton>
            )}
            <LinkButton to={`/groups/${slug}/projects/new`} primary startIcon={<Plus size={16} />}>
              New repository
            </LinkButton>
          </>
        }
      />

      <div className="shell-card">
        <div className="shell-card-header">
          <span>Repositories</span>
          <span className="font-normal text-gray-500 dark:text-gray-400">{projects.length}</span>
        </div>

        {isLoading && (
          <div className="shell-card-body py-12 text-center text-theme-sm text-gray-500 dark:text-gray-400">
            Loading…
          </div>
        )}

        {error && (
          <div className="px-6 pt-4">
            <Alert>{(error as Error).message}</Alert>
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
          <div className="overflow-x-auto">
            <table className="shell-table w-full">
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
                        className="font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
                      >
                        {project.name}
                      </Link>
                      <div className="mt-0.5 font-mono text-theme-xs text-gray-500 dark:text-gray-400">
                        {slug}/{project.slug}
                      </div>
                      {project.description && (
                        <div className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                          {project.description}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge variant={visibilityVariant(project.visibility)}>
                        {project.visibility}
                      </StatusBadge>
                    </td>
                    <td className="font-mono text-theme-sm text-gray-500 dark:text-gray-400">
                      {project.default_branch}
                    </td>
                    <td className="text-theme-sm text-gray-500 dark:text-gray-400">
                      {new Date(project.updated_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
