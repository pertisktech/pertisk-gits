import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, FolderGit2, GitBranch, Lock, Plus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { StatusBadge, visibilityVariant } from '../components/StatusBadge'
import { MetricCard } from '../components/ui/MetricCard'
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
        className="inline-flex items-center gap-1.5 border-none bg-transparent p-0 font-semibold text-inherit"
        data-no-global-button-hover="true"
        onClick={() => onSort(field)}
        aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span>{label}</span>
        <Icon size={13} className={cn('shrink-0', active ? 'text-brand-500' : 'opacity-50')} />
      </button>
    </th>
  )
}

export function DashboardPage() {
  const { user, token } = useAuth()
  const { projects, isLoading, error } = useAllProjects()
  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })
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

  const publicCount = projects.filter((p) => p.visibility === 'public').length
  const privateCount = projects.length - publicCount

  const totalPages = Math.max(1, Math.ceil(sortedProjects.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageProjects = sortedProjects.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  const rangeStart = sortedProjects.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, sortedProjects.length)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="shell-page-title">Dashboard</h1>
          <p className="shell-page-subtitle">
            Welcome back, {user?.display_name ?? user?.username}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/groups/new" className="shell-btn-outline">
            <Plus size={16} />
            New group
          </Link>
          <Link to="/groups" className="shell-btn-primary">
            All groups
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 md:gap-6">
        <MetricCard
          label="Groups"
          value={isLoading ? '…' : groups.length}
          icon={<Users size={22} />}
        />
        <MetricCard
          label="Repositories"
          value={isLoading ? '…' : projects.length}
          icon={<FolderGit2 size={22} />}
        />
        <MetricCard
          label="Public"
          value={isLoading ? '…' : publicCount}
          icon={<GitBranch size={22} />}
        />
        <MetricCard
          label="Private"
          value={isLoading ? '…' : privateCount}
          icon={<Lock size={22} />}
        />
      </div>

      {!isLoading && sortedProjects.length === 0 && (
        <div className="shell-card">
          <div className="shell-card-header">Getting started</div>
          <div className="shell-card-body grid gap-4 sm:grid-cols-3">
            {[
              {
                step: '1',
                title: 'Create a group',
                body: 'Groups are namespaces — like GitLab groups — that hold repositories.',
              },
              {
                step: '2',
                title: 'Create a repository',
                body: 'Add a repo inside your group and push code with git.',
              },
              {
                step: '3',
                title: 'Add CI/CD',
                body: (
                  <>
                    Commit <code className="font-mono text-theme-xs">.pertisk-ci.yaml</code> to run
                    pipelines.
                  </>
                ),
              },
            ].map((item) => (
              <div key={item.step} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500 text-sm font-semibold dark:bg-brand-500/15">
                  {item.step}
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-white/90">{item.title}</p>
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400 mt-1">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="px-6 pb-6">
            <Link to="/groups/new" className="shell-btn-primary">
              <Plus size={16} />
              Create your first group
            </Link>
          </div>
        </div>
      )}

      <div className="shell-card">
        <div className="shell-card-header">
          <span>All repositories</span>
          <span className="font-normal text-gray-500 dark:text-gray-400">
            {isLoading ? 'Loading…' : `${sortedProjects.length} total`}
          </span>
        </div>

        {error && (
          <div className="mx-6 mt-4 rounded-lg border border-error-500/30 bg-error-50 px-4 py-3 text-theme-sm text-error-600 dark:bg-error-500/10 dark:text-error-500">
            {(error as Error).message}
          </div>
        )}

        {!isLoading && sortedProjects.length === 0 && (
          <div className="shell-card-body text-center py-12">
            <FolderGit2 size={40} className="mx-auto text-gray-400 mb-3" />
            <p className="text-sm font-medium text-gray-800 dark:text-white/90">No repositories yet</p>
            <p className="text-theme-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">
              Create a group, then add your first repository inside it.
            </p>
            <Link to="/groups/new" className="shell-btn-primary">
              Create group
            </Link>
          </div>
        )}

        {!isLoading && sortedProjects.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="shell-table w-full">
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
                          className="font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
                        >
                          {project.name}
                        </Link>
                        <div className="text-theme-xs text-gray-500 font-mono mt-0.5 dark:text-gray-400">
                          {project.orgSlug}/{project.slug}
                        </div>
                        {project.description && (
                          <div className="text-theme-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                            {project.description}
                          </div>
                        )}
                      </td>
                      <td>
                        <Link
                          to={`/groups/${project.orgSlug}`}
                          className="text-theme-sm text-gray-500 hover:text-brand-500 dark:text-gray-400"
                        >
                          {project.orgName}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge variant={visibilityVariant(project.visibility)}>
                          {project.visibility}
                        </StatusBadge>
                      </td>
                      <td className="font-mono text-theme-sm text-gray-500 dark:text-gray-400">
                        {project.default_branch}
                      </td>
                      <td
                        className="text-theme-sm text-gray-500 dark:text-gray-400 whitespace-nowrap"
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
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-800">
                <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                  Showing {rangeStart}–{rangeEnd} of {sortedProjects.length}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-40 dark:border-gray-800 dark:bg-gray-dark dark:text-gray-400"
                    data-no-global-button-hover="true"
                    disabled={currentPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="px-2 text-theme-sm text-gray-500 tabular-nums dark:text-gray-400">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-40 dark:border-gray-800 dark:bg-gray-dark dark:text-gray-400"
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
    </div>
  )
}
