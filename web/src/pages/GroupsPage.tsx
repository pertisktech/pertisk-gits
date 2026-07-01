import { useQuery } from '@tanstack/react-query'
import { Plus, Search, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { Organization } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { GroupListRow } from '../components/GroupListRow'
import { ImportMenuDropdown } from '../components/ImportMenuDropdown'
import listStyles from '../components/ProjectList.module.css'
import { EmptyState, LinkButton, PageHeader, TablePagination } from '../components/ui'
import { useTopLevelGroupStats } from '../hooks/useTopLevelGroupStats'
import { groupUrlPath } from '../lib/groupPath'
import { useClientPagination } from '../lib/pagination'
import styles from './DashboardPage.module.css'

function matchesSearch(group: Organization, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const path = groupUrlPath(group).toLowerCase()
  return (
    group.name.toLowerCase().includes(q) ||
    group.slug.toLowerCase().includes(q) ||
    path.includes(q) ||
    (group.description?.toLowerCase().includes(q) ?? false)
  )
}

export function GroupsPage() {
  const { token } = useAuth()
  const [search, setSearch] = useState('')

  const { data: groups = [], isLoading, error } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

  const { topLevelGroups, statsByGroupId, isLoading: statsLoading } = useTopLevelGroupStats(groups)

  const filteredGroups = useMemo(
    () => topLevelGroups.filter((group) => matchesSearch(group, search)),
    [topLevelGroups, search],
  )

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
  }, [search, resetPage])

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
          <div className="p-4 pb-0 border-b border-naturals-n4">
            <div className={styles.searchWrap}>
              <Search size={15} className={styles.searchIcon} aria-hidden />
              <input
                type="search"
                className={styles.searchInput}
                placeholder="Filter by name or path…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Filter groups"
              />
            </div>
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
