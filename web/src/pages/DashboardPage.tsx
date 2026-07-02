import {
  FolderGit2,
  Plus,
  Search,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { ProjectListRow } from '../components/ProjectListRow'
import listStyles from '../components/ProjectList.module.css'
import { EmptyState, LinkButton, Select, TablePagination } from '../components/ui'
import { useAllProjects, type DashboardProject } from '../hooks/useAllProjects'
import { useDashboardProjectStats } from '../hooks/useDashboardProjectStats'
import { DEFAULT_PAGE_SIZE, useClientPagination } from '../lib/pagination'
import { repositoryActivityMs } from '../lib/repositoryActivity'
import styles from './DashboardPage.module.css'

type SortOption = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc' | 'group_asc'

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

function projectUpdatedAt(project: DashboardProject): number {
  return Math.floor(repositoryActivityMs(project) / 1000)
}

function sortProjects(projects: DashboardProject[], sort: SortOption): DashboardProject[] {
  const copy = [...projects]
  copy.sort((a, b) => {
    switch (sort) {
      case 'updated_asc':
        return projectUpdatedAt(a) - projectUpdatedAt(b)
      case 'updated_desc':
        return projectUpdatedAt(b) - projectUpdatedAt(a)
      case 'name_desc':
        return compareText(b.name, a.name)
      case 'group_asc':
        return (
          compareText(a.orgSlug, b.orgSlug) ||
          compareText(a.name, b.name)
        )
      case 'name_asc':
      default:
        return compareText(a.name, b.name)
    }
  })
  return copy
}

function matchesSearch(project: DashboardProject, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const path = `${project.orgSlug}/${project.slug}`.toLowerCase()
  return (
    project.name.toLowerCase().includes(q) ||
    project.orgName.toLowerCase().includes(q) ||
    path.includes(q)
  )
}

export function DashboardPage() {
  const { user } = useAuth()
  const { projects, isLoading, error } = useAllProjects()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortOption>('updated_desc')

  const filteredProjects = useMemo(() => {
    const filtered = projects.filter((project) => matchesSearch(project, search))
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
            {user?.display_name ?? user?.username} · all repositories you can access
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
        <div className="p-4 pb-0">
          <div className={styles.toolbar}>
            <div className={styles.searchWrap}>
              <Search size={15} className={styles.searchIcon} aria-hidden />
              <input
                type="search"
                className={styles.searchInput}
                placeholder="Filter by name or namespace…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                }}
                aria-label="Filter projects"
              />
            </div>
            <Select
              inline
              className={styles.sortSelect}
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortOption)
              }}
              aria-label="Sort projects"
            >
              <option value="updated_desc">Updated (newest)</option>
              <option value="updated_asc">Updated (oldest)</option>
              <option value="name_asc">Name (A–Z)</option>
              <option value="name_desc">Name (Z–A)</option>
              <option value="group_asc">Namespace</option>
            </Select>
          </div>
        </div>

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
              {pageProjects.map((project) => (
                <ProjectListRow
                  key={project.id}
                  orgSlug={project.orgSlug}
                  slug={project.slug}
                  name={project.name}
                  updatedAt={project.updated_at}
                  lastCommitAt={project.last_commit_at}
                  stats={getStats(project)}
                  statsLoading={statsLoading}
                />
              ))}
            </ul>

            <TablePagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              itemLabel="projects"
            />
          </>
        )}
      </div>
    </>
  )
}
