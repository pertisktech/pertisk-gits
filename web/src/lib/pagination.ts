import { useCallback, useMemo, useState } from 'react'

export const DEFAULT_PAGE_SIZE = 20

export function paginateSlice<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}

export function paginationMeta(total: number, page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const rangeEnd = Math.min(currentPage * pageSize, total)
  return { totalPages, currentPage, rangeStart, rangeEnd }
}

export function useClientPagination<T>(items: T[], pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1)
  const total = items.length

  const { totalPages, currentPage, rangeStart, rangeEnd } = useMemo(
    () => paginationMeta(total, page, pageSize),
    [total, page, pageSize],
  )

  const paginatedItems = useMemo(
    () => paginateSlice(items, currentPage, pageSize),
    [items, currentPage, pageSize],
  )

  const resetPage = useCallback(() => setPage(1), [])

  return {
    items: paginatedItems,
    page: currentPage,
    setPage,
    resetPage,
    pageSize,
    total,
    totalPages,
    rangeStart,
    rangeEnd,
  }
}
