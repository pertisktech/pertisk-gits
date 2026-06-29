import { useQuery } from '@tanstack/react-query'
import { Package, Plus, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { groupBaseUrl, groupUrlPath } from '../lib/groupPath'
import { EmptyState, LinkButton } from '../components/ui'

export function GroupsPage() {
  const { token } = useAuth()

  const { data: groups = [], isLoading, error } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

  const topLevelGroups = groups.filter((g) => !g.parent_id)

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">Groups</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Top-level namespaces; create subgroups inside each group (GitLab-style)
          </p>
        </div>
        <LinkButton to="/groups/new" primary>
          <Plus size={14} />
          New group
        </LinkButton>
      </div>

      <div className="app-panel">
        <div className="app-panel-header flex items-center justify-between">
          <span>All groups</span>
          <span className="font-normal text-text-secondary">{topLevelGroups.length} top-level</span>
        </div>

        {isLoading && <div className="p-8 text-center text-text-secondary text-sm">Loading…</div>}
        {error && (
          <div className="m-4 p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {(error as Error).message}
          </div>
        )}

        {!isLoading && topLevelGroups.length === 0 && (
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

        {!isLoading && topLevelGroups.length > 0 && (
          <table className="app-list-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Description</th>
                <th>Created</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {topLevelGroups.map((group) => (
                <tr key={group.id}>
                  <td>
                    <Link to={groupBaseUrl(group)} className="font-medium text-text hover:text-primary">
                      {group.name}
                    </Link>
                    <div className="text-xs text-muted font-mono mt-0.5">{groupUrlPath(group)}</div>
                  </td>
                  <td className="text-text-secondary">{group.description ?? '—'}</td>
                  <td className="text-text-secondary text-sm">
                    {new Date(group.created_at).toLocaleDateString()}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        to={`${groupBaseUrl(group)}/registry`}
                        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-primary"
                      >
                        <Package size={13} aria-hidden />
                        Registry
                      </Link>
                      <Link to={groupBaseUrl(group)} className="text-sm text-primary hover:underline">
                        View
                      </Link>
                    </div>
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
