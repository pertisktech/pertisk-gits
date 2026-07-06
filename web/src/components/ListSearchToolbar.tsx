import { Search } from 'lucide-react'
import { Select } from './ui'
import styles from './ListSearchToolbar.module.css'

export interface SortOption<T extends string = string> {
  value: T
  label: string
}

export function ListSearchToolbar<T extends string>({
  search,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  sort,
  onSortChange,
  sortLabel,
  sortOptions,
}: {
  search: string
  onSearchChange: (value: string) => void
  searchPlaceholder: string
  searchLabel: string
  sort: T
  onSortChange: (value: T) => void
  sortLabel: string
  sortOptions: SortOption<T>[]
}) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.searchWrap}>
        <Search size={15} className={styles.searchIcon} aria-hidden />
        <input
          type="search"
          className={styles.searchInput}
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-label={searchLabel}
        />
      </div>
      <Select
        inline
        className={styles.sortSelect}
        value={sort}
        onChange={(event) => onSortChange(event.target.value as T)}
        aria-label={sortLabel}
      >
        {sortOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  )
}
