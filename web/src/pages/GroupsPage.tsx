import { useQuery } from '@tanstack/react-query'
import { Plus, Users } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { GroupListRow } from '../components/GroupListRow'
import listStyles from '../components/ProjectList.module.css'
import { EmptyState, LinkButton } from '../components/ui'
import { useTopLevelGroupStats } from '../hooks/useTopLevelGroupStats'

export function GroupsPage() {
  const { token } = useAuth()

  const { data: groups = [], isLoading, error } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

  const { topLevelGroups, statsByGroupId, isLoading: statsLoading } = useTopLevelGroupStats(groups)

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
          <ul className={listStyles.list}>
            {topLevelGroups.map((group) => {
              const stats = statsByGroupId.get(group.id)
              return (
                <GroupListRow
                  key={group.id}
                  group={group}
                  subgroupCount={stats?.subgroups ?? 0}
                  projectCount={stats?.projects ?? 0}
                  statsLoading={statsLoading}
                />
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
