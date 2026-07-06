import type { Organization, Repository } from '../api/types'
import { groupUrlPath } from './groupPath'
import { repositoryActivityMs } from './repositoryActivity'
import type { DashboardProject } from '../hooks/useAllProjects'

export function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

export type NameSortOption = 'name_asc' | 'name_desc'
export type UpdatedSortOption = 'updated_desc' | 'updated_asc'
export type RepositorySortOption = NameSortOption | UpdatedSortOption
export type ProjectSortOption = RepositorySortOption | 'group_asc'
export type GroupSortOption = NameSortOption | UpdatedSortOption | 'path_asc'
export type GroupChildSortOption = NameSortOption | UpdatedSortOption | 'kind_asc' | 'kind_desc'

export type GroupChild =
  | { kind: 'subgroup'; name: string; subgroup: Organization }
  | { kind: 'project'; name: string; project: Repository }

export function matchesProjectSearch(
  project: Pick<DashboardProject, 'name' | 'slug' | 'orgSlug' | 'orgName'>,
  query: string,
) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const path = `${project.orgSlug}/${project.slug}`.toLowerCase()
  return (
    project.name.toLowerCase().includes(q) ||
    project.orgName.toLowerCase().includes(q) ||
    path.includes(q)
  )
}

export function matchesGroupSearch(group: Organization, query: string) {
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

export function matchesGroupChildSearch(item: GroupChild, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true

  if (item.kind === 'subgroup') {
    const { subgroup } = item
    return (
      subgroup.name.toLowerCase().includes(q) ||
      subgroup.slug.toLowerCase().includes(q) ||
      subgroup.full_path.toLowerCase().includes(q) ||
      (subgroup.description?.toLowerCase().includes(q) ?? false)
    )
  }

  const { project } = item
  return (
    project.name.toLowerCase().includes(q) ||
    project.slug.toLowerCase().includes(q)
  )
}

export function matchesRepositorySearch(
  repo: Pick<Repository, 'name' | 'slug'>,
  orgPath: string,
  query: string,
) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const path = `${orgPath}/${repo.slug}`.toLowerCase()
  return (
    repo.name.toLowerCase().includes(q) ||
    repo.slug.toLowerCase().includes(q) ||
    path.includes(q)
  )
}

export function sortRepositories(
  repos: Repository[],
  sort: RepositorySortOption,
): Repository[] {
  const copy = [...repos]
  copy.sort((a, b) => {
    switch (sort) {
      case 'updated_asc':
        return repositoryActivityMs(a) - repositoryActivityMs(b)
      case 'updated_desc':
        return repositoryActivityMs(b) - repositoryActivityMs(a)
      case 'name_desc':
        return compareText(b.name, a.name)
      case 'name_asc':
      default:
        return compareText(a.name, b.name)
    }
  })
  return copy
}

export function sortProjects(projects: DashboardProject[], sort: ProjectSortOption): DashboardProject[] {
  const copy = [...projects]
  copy.sort((a, b) => {
    switch (sort) {
      case 'updated_asc':
        return repositoryActivityMs(a) - repositoryActivityMs(b)
      case 'updated_desc':
        return repositoryActivityMs(b) - repositoryActivityMs(a)
      case 'name_desc':
        return compareText(b.name, a.name)
      case 'group_asc':
        return compareText(a.orgSlug, b.orgSlug) || compareText(a.name, b.name)
      case 'name_asc':
      default:
        return compareText(a.name, b.name)
    }
  })
  return copy
}

export function sortGroups(groups: Organization[], sort: GroupSortOption): Organization[] {
  const copy = [...groups]
  copy.sort((a, b) => {
    switch (sort) {
      case 'updated_asc':
        return Date.parse(a.updated_at) - Date.parse(b.updated_at)
      case 'updated_desc':
        return Date.parse(b.updated_at) - Date.parse(a.updated_at)
      case 'path_asc':
        return compareText(groupUrlPath(a), groupUrlPath(b)) || compareText(a.name, b.name)
      case 'name_desc':
        return compareText(b.name, a.name)
      case 'name_asc':
      default:
        return compareText(a.name, b.name)
    }
  })
  return copy
}

function groupChildUpdatedMs(item: GroupChild): number {
  if (item.kind === 'subgroup') {
    const ms = Date.parse(item.subgroup.updated_at)
    return Number.isFinite(ms) ? ms : 0
  }
  return repositoryActivityMs(item.project)
}

export function sortGroupChildren(
  items: GroupChild[],
  sort: GroupChildSortOption,
): GroupChild[] {
  const copy = [...items]
  copy.sort((a, b) => {
    switch (sort) {
      case 'kind_asc':
        return (
          (a.kind === b.kind ? 0 : a.kind === 'subgroup' ? -1 : 1) ||
          compareText(a.name, b.name)
        )
      case 'kind_desc':
        return (
          (a.kind === b.kind ? 0 : a.kind === 'project' ? -1 : 1) ||
          compareText(a.name, b.name)
        )
      case 'updated_asc':
        return groupChildUpdatedMs(a) - groupChildUpdatedMs(b)
      case 'updated_desc':
        return groupChildUpdatedMs(b) - groupChildUpdatedMs(a)
      case 'name_desc':
        return compareText(b.name, a.name)
      case 'name_asc':
      default:
        return compareText(a.name, b.name)
    }
  })
  return copy
}

export const REPOSITORY_SORT_OPTIONS: { value: RepositorySortOption; label: string }[] = [
  { value: 'updated_desc', label: 'Updated (newest)' },
  { value: 'updated_asc', label: 'Updated (oldest)' },
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
]

export const PROJECT_SORT_OPTIONS: { value: ProjectSortOption; label: string }[] = [
  ...REPOSITORY_SORT_OPTIONS,
  { value: 'group_asc', label: 'Namespace' },
]

export const GROUP_SORT_OPTIONS: { value: GroupSortOption; label: string }[] = [
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
  { value: 'updated_desc', label: 'Updated (newest)' },
  { value: 'updated_asc', label: 'Updated (oldest)' },
  { value: 'path_asc', label: 'Path' },
]

export const GROUP_CHILD_SORT_OPTIONS: { value: GroupChildSortOption; label: string }[] = [
  ...REPOSITORY_SORT_OPTIONS,
  { value: 'kind_asc', label: 'Subgroups first' },
  { value: 'kind_desc', label: 'Repositories first' },
]

export type GroupListMode = 'mixed' | 'repositories' | 'subgroups'

export function resolveGroupListMode(
  filter: 'all' | 'subgroups' | 'projects',
  subgroupCount: number,
  projectCount: number,
): GroupListMode {
  if (filter === 'projects' || (subgroupCount === 0 && projectCount > 0)) return 'repositories'
  if (filter === 'subgroups' || (projectCount === 0 && subgroupCount > 0)) return 'subgroups'
  return 'mixed'
}

export function sortOptionsForListMode(mode: GroupListMode) {
  switch (mode) {
    case 'repositories':
      return REPOSITORY_SORT_OPTIONS
    case 'subgroups':
      return GROUP_SORT_OPTIONS
    default:
      return GROUP_CHILD_SORT_OPTIONS
  }
}

export function coerceRepositorySort(sort: string): RepositorySortOption {
  if (sort === 'updated_asc' || sort === 'updated_desc' || sort === 'name_desc') return sort
  return 'name_asc'
}

export function coerceGroupSort(sort: string): GroupSortOption {
  if (
    sort === 'updated_asc' ||
    sort === 'updated_desc' ||
    sort === 'name_desc' ||
    sort === 'path_asc'
  ) {
    return sort
  }
  return 'name_asc'
}

export function coerceMixedSort(sort: string): GroupChildSortOption {
  if (
    sort === 'updated_asc' ||
    sort === 'updated_desc' ||
    sort === 'name_desc' ||
    sort === 'kind_asc' ||
    sort === 'kind_desc'
  ) {
    return sort
  }
  return 'name_asc'
}
