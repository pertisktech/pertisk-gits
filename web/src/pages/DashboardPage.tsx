import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, FolderGit2, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { StatusBadge, visibilityVariant } from '../components/StatusBadge'
import { EmptyState, LinkButton, PageHeader } from '../components/ui'
import { useAllProjects, type DashboardProject } from '../hooks/useAllProjects'
import { formatRelativeTime } from '../lib/relativeTime'
import { cn } from '../utils/cn'

const PAGE_SIZE = 15

type SortField = 'name' | 'group' | 'visibility' | 'lastCommit'
type SortDirection = 'asc' | 'desc'

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

function tieBreak(a: DashboardProject, b: DashboardProject) {
  const byName = compareText(a.name, b.name)
  if (byName !== 0) return byName
  const byOrg = compareText(a.orgSlug, b.orgSlug)
  if (byOrg !== 0) return byOrg
  return compareText(a.slug, b.slug)
}

function compareProjects(a: DashboardProject, b: DashboardProject, field: SortField): number {
  let result = 0
  switch (field) {
    case 'name':
      result = compareText(a.name, b.name)
      break
    case 'group':
      result = compareText(a.orgName, b.orgName) || compareText(a.orgSlug, b.orgSlug)
      break
    case 'visibility':
      result = compareText(a.visibility, b.visibility)
      break
    case 'lastCommit':
      result = (a.lastCommittedAt ?? 0) - (b.lastCommittedAt ?? 0)
      break
  }
  return result !== 0 ? result : tieBreak(a, b)
}

function SortableHeader({
  label,
  field,
  sortField,
  sortDirection,
  onSort,
  className,
}: {
  label: string
  field: SortField
  sortField: SortField
  sortDirection: SortDirection
  onSort: (field: SortField) => void
  className?: string
}) {
  const active = sortField === field
  const Icon = active ? (sortDirection === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown

  return (
    <th className={className}>
      <button
        type="button"
        className="app-table-sort-btn"
        data-no-global-button-hover="true"
        onClick={() => onSort(field)}
        aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span>{label}</span>
        <Icon size={13} className={cn('shrink-0', active ? 'text-primary-p3' : 'opacity-50')} />
      </button>
    </th>
  )
}

export function DashboardPage() {
  const { user } = useAuth()
  const { projects, isLoading, error } = useAllProjects()
  const [sortField, setSortField] = useState<SortField>('lastCommit')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [page, setPage] = useState(1)

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection(field === 'lastCommit' ? 'desc' : 'asc')
    }
    setPage(1)
  }

  const sortedProjects = useMemo(() => {
    const copy = [...projects]
    copy.sort((a, b) => {
      const result = compareProjects(a, b, sortField)
      return sortDirection === 'asc' ? result : -result
    })
    return copy
  }, [projects, sortField, sortDirection])

  const totalPages = Math.max(1, Math.ceil(sortedProjects.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageProjects = sortedProjects.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  const rangeStart = sortedProjects.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, sortedProjects.length)

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome, ${user?.display_name ?? user?.username}`}
        action={
          <div className="flex gap-2">
            <LinkButton to="/groups/new">
              <Plus size={14} />
              New group
            </LinkButton>
            <LinkButton to="/groups" primary>
              All groups
            </LinkButton>
          </div>
        }
      />

      {!isLoading && sortedProjects.length === 0 && (
        <div className="app-panel mb-4">
          <div className="app-panel-header">Getting started</div>
          <div className="p-5 grid gap-4 sm:grid-cols-3">
            <div className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-p4/15 text-primary text-sm font-semibold">
                1
              </span>
              <div>
                <p className="text-sm font-medium text-text">Create a group</p>
                <p className="text-xs text-text-secondary mt-0.5">
                  Groups are namespaces — like GitLab groups — that hold repositories.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-p4/15 text-primary text-sm font-semibold">
                2
              </span>
              <div>
                <p className="text-sm font-medium text-text">Create a repository</p>
                <p className="text-xs text-text-secondary mt-0.5">
                  Add a repo inside your group and push code with git.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-p4/15 text-primary text-sm font-semibold">
                3
              </span>
              <div>
                <p className="text-sm font-medium text-text">Add CI/CD</p>
                <p className="text-xs text-text-secondary mt-0.5">
                  Commit <code className="font-mono">.pertisk-ci.yaml</code> to run pipelines.
                </p>
              </div>
            </div>
          </div>
          <div className="px-5 pb-5">
            <LinkButton to="/groups/new" primary>
              <Plus size={14} />
              Create your first group
            </LinkButton>
          </div>
        </div>
      )}

      <div className="app-panel">
        <div className="app-panel-header flex items-center justify-between gap-3">
          <span>All repositories</span>
          <span className="font-normal text-text-secondary">
            {isLoading ? 'Loading…' : `${sortedProjects.length} total`}
          </span>
        </div>

        {error && (
          <div className="m-4 p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {(error as Error).message}
          </div>
        )}

        {!isLoading && sortedProjects.length === 0 && (
          <EmptyState
            icon={<FolderGit2 size={40} />}
            title="No repositories yet"
            description="Create a group, then add your first repository inside it."
            action={
              <LinkButton to="/groups/new" primary>
                Create group
              </LinkButton>
            }
          />
        )}

        {!isLoading && sortedProjects.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="app-list-table">
                <thead>
                  <tr>
                    <SortableHeader
                      label="Repository"
                      field="name"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Group"
                      field="group"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Visibility"
                      field="visibility"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                    <th>Branch</th>
                    <SortableHeader
                      label="Last commit"
                      field="lastCommit"
                      sortField={sortField}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                      className="w-40"
                    />
                  </tr>
                </thead>
                <tbody>
                  {pageProjects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <Link
                          to={`/groups/${project.orgSlug}/projects/${project.slug}`}
                          className="font-medium text-text hover:text-primary"
                        >
                          {project.name}
                        </Link>
                        <div className="text-xs text-muted font-mono mt-0.5">
                          {project.orgSlug}/{project.slug}
                        </div>
                        {project.description && (
                          <div className="text-xs text-text-secondary mt-1 line-clamp-2">
                            {project.description}
                          </div>
                        )}
                      </td>
                      <td>
                        <Link
                          to={`/groups/${project.orgSlug}`}
                          className="text-sm text-text-secondary hover:text-primary"
                        >
                          {project.orgName}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge variant={visibilityVariant(project.visibility)}>
                          {project.visibility}
                        </StatusBadge>
                      </td>
                      <td className="font-mono text-sm text-text-secondary">
                        {project.default_branch}
                      </td>
                      <td
                        className="text-sm text-text-secondary whitespace-nowrap"
                        title={
                          project.lastCommittedAt
                            ? new Date(project.lastCommittedAt * 1000).toLocaleString()
                            : undefined
                        }
                      >
                        {project.lastCommitLoading
                          ? '…'
                          : project.lastCommittedAt
                            ? formatRelativeTime(project.lastCommittedAt)
                            : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="app-table-pagination">
                <p className="text-sm text-text-secondary">
                  Showing {rangeStart}–{rangeEnd} of {sortedProjects.length}
                </p>
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
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
