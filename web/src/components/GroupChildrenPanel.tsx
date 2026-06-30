import { useEffect, useMemo, useState } from 'react'
import { FolderGit2 } from 'lucide-react'
import type { DashboardProjectStats, Organization, Repository } from '../api/types'
import { useGroupStats } from '../hooks/useGroupStats'
import { GroupListRow } from './GroupListRow'
import { ProjectListRow } from './ProjectListRow'
import listStyles from './ProjectList.module.css'
import { AppSegment } from './AppSegment'
import { EmptyState, LinkButton, TablePagination } from './ui'
import { useClientPagination } from '../lib/pagination'

type ChildFilter = 'all' | 'subgroups' | 'projects'

type GroupChild =
  | { kind: 'subgroup'; name: string; subgroup: Organization }
  | { kind: 'project'; name: string; project: Repository }

function matchesSearch(item: GroupChild, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true

  if (item.kind === 'subgroup') {
    const { subgroup } = item
    return (
      subgroup.name.toLowerCase().includes(q) ||
      subgroup.slug.toLowerCase().includes(q) ||
      subgroup.full_path.toLowerCase().includes(q)
    )
  }

  const { project } = item
  return (
    project.name.toLowerCase().includes(q) ||
    project.slug.toLowerCase().includes(q)
  )
}

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
}) {
  const [filter, setFilter] = useState<ChildFilter>('all')
  const [search, setSearch] = useState('')

  const { statsByGroupId, isLoading: subgroupStatsLoading } = useGroupStats(subgroups, allGroups)

  const children = useMemo<GroupChild[]>(() => {
    const subgroupItems: GroupChild[] = subgroups
      .map((subgroup) => ({
        kind: 'subgroup' as const,
        name: subgroup.name,
        subgroup,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

    const projectItems: GroupChild[] = projects
      .map((project) => ({
        kind: 'project' as const,
        name: project.name,
        project,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

    return [...subgroupItems, ...projectItems]
  }, [subgroups, projects])

  const filteredChildren = useMemo(() => {
    return children.filter((item) => {
      if (filter === 'subgroups' && item.kind !== 'subgroup') return false
      if (filter === 'projects' && item.kind !== 'project') return false
      return matchesSearch(item, search)
    })
  }, [children, filter, search])

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
  }, [filter, search, resetPage])

  const isLoading = subgroupsLoading || projectsLoading
  const hasBoth = subgroups.length > 0 && projects.length > 0
  const totalCount = subgroups.length + projects.length

  const tabs = [
    { id: 'all', label: `All ${totalCount}` },
    { id: 'subgroups', label: `Subgroups ${subgroups.length}` },
    { id: 'projects', label: `Projects ${projects.length}` },
  ]

  return (
    <div className="app-panel">
      <div className="app-panel-header flex items-center justify-between">
        <span>Subgroups and projects</span>
        {!isLoading && (
          <span className="font-normal text-text-secondary">{totalCount} total</span>
        )}
      </div>

      <div className="px-4 pt-3">
        {hasBoth && (
          <AppSegment
            tabs={tabs}
            active={filter}
            onChange={(id) => setFilter(id as ChildFilter)}
            action={
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by name"
                className="app-field max-w-[14rem] !py-1.5 !text-sm"
                aria-label="Filter subgroups and projects"
              />
            }
          />
        )}
        {!hasBoth && totalCount > 0 && (
          <div className="mb-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name"
              className="app-field max-w-xs !py-1.5 !text-sm"
              aria-label="Filter subgroups and projects"
            />
          </div>
        )}
      </div>

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
          title="No subgroups or projects"
          description="Create a subgroup or repository in this group."
          action={
            <LinkButton to={`${basePath}/projects/new`} primary>
              New repository
            </LinkButton>
          }
        />
      )}

      {!isLoading && totalCount > 0 && filteredChildren.length === 0 && (
        <div className="p-8 text-center text-text-secondary text-sm">
          No matches for &ldquo;{search.trim()}&rdquo;
        </div>
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
          itemLabel="items"
        />
      )}
    </div>
  )
}
