import {
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  Plus,
  Search,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { DashboardProjectAside } from '../components/DashboardProjectAside'
import { EmptyState, LinkButton } from '../components/ui'
import { useAllProjects, type DashboardProject } from '../hooks/useAllProjects'
import { useDashboardProjectStats } from '../hooks/useDashboardProjectStats'
import { projectInitial } from '../lib/projectInitial'
import { formatRelativeTimeFromIso } from '../lib/relativeTime'
import styles from './DashboardPage.module.css'

const PAGE_SIZE = 20

type SortOption = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc' | 'group_asc'

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

function projectUpdatedAt(project: DashboardProject): number {
  const parsed = Date.parse(project.updated_at)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0
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

function lastActivityLabel(project: DashboardProject) {
  return formatRelativeTimeFromIso(project.updated_at)
}

export function DashboardPage() {
  const { user } = useAuth()
  const { projects, isLoading, error } = useAllProjects()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortOption>('updated_desc')
  const [page, setPage] = useState(1)

  const filteredProjects = useMemo(() => {
    const filtered = projects.filter((project) => matchesSearch(project, search))
    return sortProjects(filtered, sort)
  }, [projects, search, sort])

  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageProjects = filteredProjects.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )
  const { getStats, isLoading: statsLoading } = useDashboardProjectStats(pageProjects)

  const rangeStart =
    filteredProjects.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredProjects.length)

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
                  setPage(1)
                }}
                aria-label="Filter projects"
              />
            </div>
            <select
              className={styles.sortSelect}
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortOption)
                setPage(1)
              }}
              aria-label="Sort projects"
            >
              <option value="updated_desc">Updated (newest)</option>
              <option value="updated_asc">Updated (oldest)</option>
              <option value="name_asc">Name (A–Z)</option>
              <option value="name_desc">Name (Z–A)</option>
              <option value="group_asc">Namespace</option>
            </select>
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
            <ul className={styles.list}>
              {pageProjects.map((project) => (
                <li key={project.id} className={styles.row}>
                  <div className={styles.icon} aria-hidden>
                    <span className={styles.iconLetter}>
                      {projectInitial(project.name, project.slug)}
                    </span>
                  </div>
                  <div className={styles.main}>
                    <Link
                      to={`/groups/${project.orgSlug}/projects/${project.slug}`}
                      className={styles.pathLink}
                    >
                      <span className={styles.pathGroup}>{project.orgSlug}</span>
                      <span className={styles.pathSep}>/</span>
                      <span>{project.name}</span>
                    </Link>
                  </div>
                  <DashboardProjectAside
                    orgSlug={project.orgSlug}
                    slug={project.slug}
                    visibility={project.visibility}
                    stats={getStats(project)}
                    loading={statsLoading}
                  />
                  <div className={styles.meta}>
                    <span
                      className={styles.updated}
                      title={new Date(project.updated_at).toLocaleString()}
                    >
                      {lastActivityLabel(project)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            {(totalPages > 1 || filteredProjects.length > 0) && (
              <div className={styles.pagination}>
                <p className="text-sm text-text-secondary m-0">
                  {filteredProjects.length === 0
                    ? '0 projects'
                    : `Showing ${rangeStart}–${rangeEnd} of ${filteredProjects.length}`}
                </p>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="app-table-page-btn"
                      data-no-global-button-hover="true"
                      disabled={currentPage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="px-2 text-sm text-text-secondary tabular-nums">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      className="app-table-page-btn"
                      data-no-global-button-hover="true"
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      aria-label="Next page"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
