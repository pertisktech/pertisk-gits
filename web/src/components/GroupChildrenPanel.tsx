import { useEffect, useMemo, useState } from 'react'
import { FolderGit2 } from 'lucide-react'
import type { DashboardProjectStats, Organization, Repository } from '../api/types'
import { useGroupStats } from '../hooks/useGroupStats'
import {
  coerceGroupSort,
  coerceMixedSort,
  coerceRepositorySort,
  matchesGroupChildSearch,
  matchesGroupSearch,
  matchesRepositorySearch,
  resolveGroupListMode,
  sortGroupChildren,
  sortGroups,
  sortOptionsForListMode,
  sortRepositories,
  type GroupChild,
  type GroupChildSortOption,
  type GroupSortOption,
  type RepositorySortOption,
} from '../lib/listSort'
import { GroupListRow } from './GroupListRow'
import { ListSearchToolbar } from './ListSearchToolbar'
import { ProjectListRow } from './ProjectListRow'
import listStyles from './ProjectList.module.css'
import { AppSegment } from './AppSegment'
import { EmptyState, LinkButton, TablePagination } from './ui'
import { ImportMenuDropdown } from './ImportMenuDropdown'
import { useClientPagination } from '../lib/pagination'
import styles from '../pages/DashboardPage.module.css'

type ChildFilter = 'all' | 'subgroups' | 'projects'
type ListSortOption = RepositorySortOption | GroupSortOption | GroupChildSortOption

export function GroupChildrenPanel({
  orgPath,
  basePath,
  subgroups,
  subgroupsLoading,
  projects,
  projectsLoading,
  projectsError,
  allGroups,
  getProjectStats,
  projectStatsLoading,
  canManage = false,
}: {
  orgPath: string
  basePath: string
  subgroups: Organization[]
  subgroupsLoading: boolean
  projects: Repository[]
  projectsLoading: boolean
  projectsError?: Error | null
  allGroups: Organization[]
  getProjectStats: (ref: { orgSlug: string; slug: string }) => DashboardProjectStats | undefined
  projectStatsLoading: boolean
  canManage?: boolean
}) {
  const [filter, setFilter] = useState<ChildFilter>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ListSortOption>('updated_desc')

  const { statsByGroupId, isLoading: subgroupStatsLoading } = useGroupStats(subgroups, allGroups)

  const isLoading = subgroupsLoading || projectsLoading
  const hasBoth = subgroups.length > 0 && projects.length > 0
  const totalCount = subgroups.length + projects.length
  const listMode = resolveGroupListMode(filter, subgroups.length, projects.length)
  const sortOptions = sortOptionsForListMode(listMode)

  const filteredChildren = useMemo<GroupChild[]>(() => {
    if (listMode === 'repositories') {
      return sortRepositories(
        projects.filter((project) => matchesRepositorySearch(project, orgPath, search)),
        coerceRepositorySort(sort),
      ).map((project) => ({
        kind: 'project' as const,
        name: project.name,
        project,
      }))
    }

    if (listMode === 'subgroups') {
      return sortGroups(
        subgroups.filter((subgroup) => matchesGroupSearch(subgroup, search)),
        coerceGroupSort(sort),
      ).map((subgroup) => ({
        kind: 'subgroup' as const,
        name: subgroup.name,
        subgroup,
      }))
    }

    const children: GroupChild[] = [
      ...subgroups.map((subgroup) => ({
        kind: 'subgroup' as const,
        name: subgroup.name,
        subgroup,
      })),
      ...projects.map((project) => ({
        kind: 'project' as const,
        name: project.name,
        project,
      })),
    ]

    const filtered = children.filter((item) => matchesGroupChildSearch(item, search))
    return sortGroupChildren(filtered, coerceMixedSort(sort))
  }, [listMode, orgPath, projects, search, sort, subgroups])

  const {
    items: pageChildren,
    page,
    setPage,
    resetPage,
    pageSize,
    total: filteredTotal,
  } = useClientPagination(filteredChildren)

  useEffect(() => {
    resetPage()
  }, [filter, search, sort, resetPage])

  useEffect(() => {
    const allowed = new Set(sortOptionsForListMode(listMode).map((option) => option.value))
    if (!allowed.has(sort)) {
      setSort(listMode === 'repositories' ? 'updated_desc' : 'name_asc')
    }
  }, [listMode, sort])

  const tabs = [
    { id: 'all', label: `All ${totalCount}` },
    { id: 'subgroups', label: `Subgroups ${subgroups.length}` },
    { id: 'projects', label: `Repositories ${projects.length}` },
  ]

  const panelTitle =
    listMode === 'repositories'
      ? 'Repositories'
      : listMode === 'subgroups'
        ? 'Subgroups'
        : 'Subgroups and repositories'

  const searchLabel =
    listMode === 'repositories'
      ? 'Filter repositories'
      : listMode === 'subgroups'
        ? 'Filter subgroups'
        : 'Filter subgroups and repositories'

  const sortLabel =
    listMode === 'repositories'
      ? 'Sort repositories'
      : listMode === 'subgroups'
        ? 'Sort subgroups'
        : 'Sort subgroups and repositories'

  return (
    <div className="app-panel">
      <div className="app-panel-header flex items-center justify-between">
        <span>{panelTitle}</span>
        {!isLoading && (
          <span className="font-normal text-text-secondary">{totalCount} total</span>
        )}
      </div>

      {!isLoading && totalCount > 0 && (
        <div className="px-4 pt-3">
          {hasBoth && (
            <AppSegment
              tabs={tabs}
              active={filter}
              onChange={(id) => setFilter(id as ChildFilter)}
            />
          )}
          <ListSearchToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Filter by name or path…"
            searchLabel={searchLabel}
            sort={sort}
            onSortChange={setSort}
            sortLabel={sortLabel}
            sortOptions={sortOptions}
          />
        </div>
      )}

      {isLoading && (
        <div className="p-8 text-center text-text-secondary text-sm">Loading…</div>
      )}

      {projectsError && (
        <div className="m-4 p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {projectsError.message}
        </div>
      )}

      {!isLoading && totalCount === 0 && (
        <EmptyState
          icon={<FolderGit2 size={40} />}
          title="No subgroups or repositories"
          description={
            canManage
              ? 'Create a repository, import from GitHub or GitLab, or add a subgroup.'
              : 'Create a subgroup or repository in this group.'
          }
          action={
            canManage ? (
              <div className="flex flex-wrap justify-center gap-2">
                <ImportMenuDropdown basePath={basePath} />
                <LinkButton to={`${basePath}/projects/new`} primary>
                  New repository
                </LinkButton>
              </div>
            ) : (
              <LinkButton to={`${basePath}/projects/new`} primary>
                New repository
              </LinkButton>
            )
          }
        />
      )}

      {!isLoading && totalCount > 0 && filteredChildren.length === 0 && (
        <div className={styles.emptyHint}>No matches for &ldquo;{search.trim()}&rdquo;</div>
      )}

      {!isLoading && filteredChildren.length > 0 && (
        <ul className={listStyles.list}>
          {pageChildren.map((item) =>
            item.kind === 'subgroup' ? (
              <GroupListRow
                key={`subgroup-${item.subgroup.id}`}
                group={item.subgroup}
                subgroupCount={statsByGroupId.get(item.subgroup.id)?.subgroups ?? 0}
                projectCount={statsByGroupId.get(item.subgroup.id)?.projects ?? 0}
                statsLoading={subgroupStatsLoading}
              />
            ) : (
              <ProjectListRow
                key={`project-${item.project.id}`}
                orgSlug={orgPath}
                slug={item.project.slug}
                name={item.project.name}
                updatedAt={item.project.updated_at}
                lastCommitAt={item.project.last_commit_at}
                stats={getProjectStats({ orgSlug: orgPath, slug: item.project.slug })}
                statsLoading={projectStatsLoading}
              />
            ),
          )}
        </ul>
      )}

      {!isLoading && filteredTotal > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={filteredTotal}
          onPageChange={setPage}
          itemLabel={listMode === 'repositories' ? 'repositories' : 'items'}
        />
      )}
    </div>
  )
}
