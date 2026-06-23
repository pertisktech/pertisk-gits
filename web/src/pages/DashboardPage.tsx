import { useQuery } from '@tanstack/react-query'
import { FolderGit2, Plus, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EmptyState, LinkButton } from '../components/ui'

export function DashboardPage() {
  const { token, user } = useAuth()

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

  const recentGroups = groups.slice(0, 8)

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">Dashboard</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Welcome, {user?.display_name ?? user?.username}
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton to="/groups/new">
            <Plus size={14} />
            New group
          </LinkButton>
          <LinkButton to="/groups" primary>
            Repositories
          </LinkButton>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div className="gogs-panel p-4">
          <div className="text-2xl font-bold text-primary">{isLoading ? '—' : groups.length}</div>
          <div className="text-sm text-text-secondary mt-0.5">Groups</div>
        </div>
        <div className="gogs-panel p-4">
          <div className="text-2xl font-bold text-primary">Git</div>
          <div className="text-sm text-text-secondary mt-0.5">HTTP enabled</div>
        </div>
        <div className="gogs-panel p-4">
          <div className="text-2xl font-bold text-primary">v0.1</div>
          <div className="text-sm text-text-secondary mt-0.5">Platform</div>
        </div>
      </div>

      <div className="gogs-panel">
        <div className="gogs-panel-header flex items-center justify-between">
          <span>Your repositories</span>
          <Link to="/groups" className="text-primary hover:underline font-normal">
            View all
          </Link>
        </div>

        {isLoading && <div className="p-8 text-center text-text-secondary text-sm">Loading…</div>}

        {!isLoading && recentGroups.length === 0 && (
          <EmptyState
            icon={<Users size={40} />}
            title="No groups yet"
            description="Create a group to host Git repositories."
            action={
              <LinkButton to="/groups/new" primary>
                Create group
              </LinkButton>
            }
          />
        )}

        {!isLoading && recentGroups.length > 0 && (
          <table className="gogs-list-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Description</th>
                <th className="w-32" />
              </tr>
            </thead>
            <tbody>
              {recentGroups.map((group) => (
                <tr key={group.id}>
                  <td>
                    <Link to={`/groups/${group.slug}`} className="font-medium text-text hover:text-primary">
                      {group.name}
                    </Link>
                    <div className="text-xs text-muted font-mono mt-0.5">{group.slug}</div>
                  </td>
                  <td className="text-text-secondary">{group.description ?? '—'}</td>
                  <td className="text-right">
                    <Link
                      to={`/groups/${group.slug}/projects/new`}
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      <FolderGit2 size={14} />
                      New repo
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
