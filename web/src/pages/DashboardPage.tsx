import { FolderGit2, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useEffectiveUser } from '../auth/AuthContext'
import { ListSearchToolbar } from '../components/ListSearchToolbar'
import { ProjectListRow } from '../components/ProjectListRow'
import listStyles from '../components/ProjectList.module.css'
import { EmptyState, LinkButton, TablePagination } from '../components/ui'
import { useAllProjects } from '../hooks/useAllProjects'
import { useDashboardProjectStats } from '../hooks/useDashboardProjectStats'
import {
  matchesProjectSearch,
  PROJECT_SORT_OPTIONS,
  sortProjects,
  type ProjectSortOption,
} from '../lib/listSort'
import { groupBreadcrumbItems } from '../lib/groupRoute'
import { displayRepoName } from '../lib/projectInitial'
import { DEFAULT_PAGE_SIZE, useClientPagination } from '../lib/pagination'
import styles from './DashboardPage.module.css'

export function DashboardPage() {
  const user = useEffectiveUser()
  const { projects, isLoading, error } = useAllProjects()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ProjectSortOption>('updated_desc')

  const filteredProjects = useMemo(() => {
    const filtered = projects.filter((project) => matchesProjectSearch(project, search))
    return sortProjects(filtered, sort)
  }, [projects, search, sort])

  const {
    items: pageProjects,
    page,
    setPage,
    resetPage,
    pageSize,
    total,
  } = useClientPagination(filteredProjects, DEFAULT_PAGE_SIZE)

  useEffect(() => {
    resetPage()
  }, [search, sort, resetPage])

  const { getStats, isLoading: statsLoading } = useDashboardProjectStats(pageProjects)

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text m-0">Projects</h1>
          <p className="text-sm text-text-secondary mt-1 mb-0">
            {user?.display_name ?? user?.username} · public repositories and projects in your groups
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton to="/groups/new">
            <Plus size={14} />
            New group
          </LinkButton>
          <LinkButton to="/groups" primary>
            Browse groups
          </LinkButton>
        </div>
      </div>

      {!isLoading && projects.length === 0 && (
        <div className="app-panel mb-4">
          <div className="app-panel-header">Get started</div>
          <div className="p-5 text-sm text-text-secondary space-y-2">
            <p>Create a group, add a repository, and push your first commit.</p>
            <LinkButton to="/groups/new" primary>
              <Plus size={14} />
              Create your first group
            </LinkButton>
          </div>
        </div>
      )}

      <div className="app-panel">
        {!isLoading && projects.length > 0 && (
          <div className="p-4 pb-0">
            <ListSearchToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Filter by name or namespace…"
              searchLabel="Filter repositories"
              sort={sort}
              onSortChange={setSort}
              sortLabel="Sort repositories"
              sortOptions={PROJECT_SORT_OPTIONS}
            />
          </div>
        )}

        {error && (
          <div className="mx-4 mb-4 p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {(error as Error).message}
          </div>
        )}

        {isLoading && (
          <div className={styles.emptyHint}>Loading projects…</div>
        )}

        {!isLoading && filteredProjects.length === 0 && projects.length > 0 && (
          <div className={styles.emptyHint}>No projects match your filter.</div>
        )}

        {!isLoading && projects.length === 0 && (
          <EmptyState
            icon={<FolderGit2 size={40} />}
            title="No projects yet"
            description="Create a group, then add your first repository."
            action={
              <LinkButton to="/groups/new" primary>
                Create group
              </LinkButton>
            }
          />
        )}

        {!isLoading && pageProjects.length > 0 && (
          <>
            <ul className={listStyles.list}>
              {pageProjects.map((project) => {
                const groupLabels = groupBreadcrumbItems(project.orgSlug)
                  .slice(1)
                  .map((item) => item.label)
                const displayLabel = [...groupLabels, displayRepoName(project.name, project.slug)].join('/')

                return (
                  <ProjectListRow
                    key={project.id}
                    orgSlug={project.orgSlug}
                    orgName={project.orgName}
                    slug={project.slug}
                    name={project.name}
                    updatedAt={project.updated_at}
                    lastCommitAt={project.last_commit_at}
                    stats={getStats(project)}
                    statsLoading={statsLoading}
                    displayLabel={displayLabel}
                  />
                )
              })}
            </ul>

            <TablePagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              itemLabel="repositories"
            />
          </>
        )}
      </div>
    </>
  )
}
