import { useQuery } from '@tanstack/react-query'
import { Package, Plus, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Alert, EmptyState, LinkButton, PageHeader } from '../components/ui'

export function GroupsPage() {
  const { token } = useAuth()

  const { data: groups = [], isLoading, error } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Groups"
        subtitle="Top-level namespaces that contain your repositories"
        action={
          <LinkButton to="/groups/new" primary startIcon={<Plus size={16} />}>
            New group
          </LinkButton>
        }
      />

      <div className="shell-card">
        <div className="shell-card-header">
          <span>All groups</span>
          <span className="font-normal text-gray-500 dark:text-gray-400">{groups.length} total</span>
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

        {!isLoading && groups.length === 0 && (
          <EmptyState
            icon={<Users size={40} />}
            title="No groups found"
            description="Groups are the top-level namespace for your repositories."
            action={
              <LinkButton to="/groups/new" primary>
                Create your first group
              </LinkButton>
            }
          />
        )}

        {!isLoading && groups.length > 0 && (
          <div className="overflow-x-auto">
            <table className="shell-table w-full">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Description</th>
                  <th>Created</th>
                  <th className="w-28" />
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.id}>
                    <td>
                      <Link
                        to={`/groups/${group.slug}`}
                        className="font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
                      >
                        {group.name}
                      </Link>
                      <div className="mt-0.5 font-mono text-theme-xs text-gray-500 dark:text-gray-400">
                        {group.slug}
                      </div>
                    </td>
                    <td className="text-gray-500 dark:text-gray-400">{group.description ?? '—'}</td>
                    <td className="text-theme-sm text-gray-500 dark:text-gray-400">
                      {new Date(group.created_at).toLocaleDateString()}
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          to={`/groups/${group.slug}/registry`}
                          className="inline-flex items-center gap-1 text-theme-sm text-gray-500 hover:text-brand-500 dark:text-gray-400"
                        >
                          <Package size={14} aria-hidden />
                          Registry
                        </Link>
                        <Link
                          to={`/groups/${group.slug}`}
                          className="text-theme-sm font-medium text-brand-500 hover:text-brand-600"
                        >
                          View
                        </Link>
                      </div>
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
