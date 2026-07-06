import { useQuery } from '@tanstack/react-query'
import { Plus, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { GroupListRow } from '../components/GroupListRow'
import { ImportMenuDropdown } from '../components/ImportMenuDropdown'
import { ListSearchToolbar } from '../components/ListSearchToolbar'
import listStyles from '../components/ProjectList.module.css'
import { EmptyState, LinkButton, PageHeader, TablePagination } from '../components/ui'
import { useTopLevelGroupStats } from '../hooks/useTopLevelGroupStats'
import {
  GROUP_SORT_OPTIONS,
  matchesGroupSearch,
  sortGroups,
  type GroupSortOption,
} from '../lib/listSort'
import { useClientPagination } from '../lib/pagination'
import styles from './DashboardPage.module.css'

export function GroupsPage() {
  const { token } = useAuth()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<GroupSortOption>('name_asc')

  const { data: groups = [], isLoading, error } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

  const { topLevelGroups, statsByGroupId, isLoading: statsLoading } = useTopLevelGroupStats(groups)

  const filteredGroups = useMemo(() => {
    const filtered = topLevelGroups.filter((group) => matchesGroupSearch(group, search))
    return sortGroups(filtered, sort)
  }, [topLevelGroups, search, sort])

  const {
    items: pageGroups,
    page,
    setPage,
    resetPage,
    pageSize,
    total,
  } = useClientPagination(filteredGroups)

  useEffect(() => {
    resetPage()
  }, [search, sort, resetPage])

  return (
    <>
      <PageHeader
        title="Groups"
        subtitle="Top-level namespaces for repositories and subgroups"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ImportMenuDropdown />
            <LinkButton to="/groups/new" primary>
              <Plus size={14} />
              New group
            </LinkButton>
          </div>
        }
      />

      <div className="app-panel">
        <div className="app-panel-header flex items-center justify-between gap-3">
          <span>All groups</span>
          <span className="font-normal text-text-secondary">
            {topLevelGroups.length} top-level
          </span>
        </div>

        {!isLoading && topLevelGroups.length > 0 && (
          <div className="p-4 pb-0">
            <ListSearchToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Filter by name or path…"
              searchLabel="Filter groups"
              sort={sort}
              onSortChange={setSort}
              sortLabel="Sort groups"
              sortOptions={GROUP_SORT_OPTIONS}
            />
          </div>
        )}

        {isLoading && <div className="p-8 text-center text-text-secondary text-sm">Loading…</div>}
        {error && (
          <div className="m-4 p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {(error as Error).message}
          </div>
        )}

        {!isLoading && topLevelGroups.length === 0 && (
          <EmptyState
            icon={<Users size={40} />}
            title="No groups yet"
            description="Create a group to organize repositories, or import projects from GitHub or GitLab."
            action={
              <LinkButton to="/groups/new" primary>
                <Plus size={14} />
                Create your first group
              </LinkButton>
            }
          />
        )}

        {!isLoading && topLevelGroups.length > 0 && filteredGroups.length === 0 && (
          <div className={styles.emptyHint}>No groups match your filter.</div>
        )}

        {!isLoading && filteredGroups.length > 0 && (
          <ul className={listStyles.list}>
            {pageGroups.map((group) => {
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

        {!isLoading && total > 0 && (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            itemLabel="groups"
          />
        )}
      </div>
    </>
  )
}
