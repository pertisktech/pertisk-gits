import { useQuery } from '@tanstack/react-query'
import { Plus, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EmptyState, LinkButton, PageHeader } from '../components/ui'

export function GroupsPage() {
  const { token } = useAuth()

  const { data: groups = [], isLoading, error } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

  return (
    <>
      <PageHeader
        title="Groups"
        subtitle="Organize projects and manage access."
        action={
          <LinkButton to="/groups/new" primary>
            <Plus size={14} />
            New group
          </LinkButton>
        }
      />

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text">All groups</h2>
          <span className="text-sm text-text-secondary">{groups.length} total</span>
        </div>

        {isLoading && <div className="p-8 text-center text-text-secondary">Loading groups…</div>}
        {error && (
          <div className="m-4 p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {(error as Error).message}
          </div>
        )}

        {!isLoading && groups.length === 0 && (
          <EmptyState
            icon={<Users size={40} />}
            title="No groups found"
            description="Groups are the top-level namespace for your repositories."
            action={<LinkButton to="/groups/new" primary>Create your first group</LinkButton>}
          />
        )}

        {!isLoading && groups.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-elevated">
                <th className="px-4 py-2 text-left font-semibold text-text">Group</th>
                <th className="px-4 py-2 text-left font-semibold text-text">Description</th>
                <th className="px-4 py-2 text-left font-semibold text-text">Created</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {groups.map((group, i) => (
                <tr
                  key={group.id}
                  className={`border-b border-border hover:bg-hover ${i % 2 ? 'bg-surface-elevated' : 'bg-surface'}`}
                >
                  <td className="px-4 py-3">
                    <Link to={`/groups/${group.slug}`} className="font-medium text-text hover:text-primary">
                      {group.name}
                    </Link>
                    <div className="text-xs text-text-secondary font-mono">pertisk-gits/{group.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{group.description ?? '—'}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    {new Date(group.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/groups/${group.slug}`} className="text-sm text-primary hover:underline">
                      Manage
                    </Link>
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
