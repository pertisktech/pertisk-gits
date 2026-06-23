import { useQuery } from '@tanstack/react-query'
import { FolderGit2, Plus, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { StatCard } from '../components/Card'
import { EmptyState, LinkButton, PageHeader } from '../components/ui'

export function DashboardPage() {
  const { token, user } = useAuth()

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

  const recentGroups = groups.slice(0, 5)

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome back, ${user?.display_name ?? user?.username}`}
        action={
          <div className="flex gap-2">
            <LinkButton to="/groups/new">New group</LinkButton>
            <LinkButton to="/groups" primary>
              <Plus size={14} />
              Browse groups
            </LinkButton>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Groups" value={isLoading ? '—' : groups.length} />
        <StatCard label="Platform" value="Phase 1" />
        <StatCard label="Git HTTP" value="Enabled" />
      </div>

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text">Your groups</h2>
          <Link to="/groups" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>

        {isLoading && <div className="p-8 text-center text-text-secondary">Loading groups…</div>}

        {!isLoading && recentGroups.length === 0 && (
          <EmptyState
            icon={<Users size={40} />}
            title="No groups yet"
            description="Create a group to organize your projects."
            action={<LinkButton to="/groups/new" primary>Create group</LinkButton>}
          />
        )}

        {!isLoading && recentGroups.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-elevated">
                <th className="px-4 py-2 text-left font-semibold text-text">Group</th>
                <th className="px-4 py-2 text-left font-semibold text-text">Description</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {recentGroups.map((group, i) => (
                <tr
                  key={group.id}
                  className={`border-b border-border hover:bg-hover ${i % 2 ? 'bg-surface-elevated' : 'bg-surface'}`}
                >
                  <td className="px-4 py-3">
                    <Link to={`/groups/${group.slug}`} className="font-medium text-text hover:text-primary">
                      {group.name}
                    </Link>
                    <div className="text-xs text-text-secondary">@{group.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{group.description ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/groups/${group.slug}/projects/new`}
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      <FolderGit2 size={14} />
                      New project
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
