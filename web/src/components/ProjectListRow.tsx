import { Link } from 'react-router-dom'
import type { DashboardProjectStats } from '../api/types'
import { displayRepoName, projectInitial } from '../lib/projectInitial'
import { formatRelativeTimeFromIso } from '../lib/relativeTime'
import { cn } from '../utils/cn'
import { DashboardProjectAside } from './DashboardProjectAside'
import styles from './ProjectList.module.css'

export function ProjectListRow({
  orgSlug,
  slug,
  name,
  updatedAt,
  stats,
  statsLoading,
}: {
  orgSlug: string
  slug: string
  name: string
  updatedAt: string
  stats?: DashboardProjectStats
  statsLoading?: boolean
}) {
  const shortName = displayRepoName(name, slug)

  return (
    <li className={styles.row}>
      <div className={cn(styles.icon, styles.iconRepo)} aria-hidden>
        <span className={styles.iconLetter}>{projectInitial(shortName, slug)}</span>
      </div>
      <div className={styles.main}>
        <Link
          to={`/groups/${orgSlug}/projects/${slug}`}
          className={styles.pathLink}
        >
          <span className={styles.pathGroup}>{orgSlug}</span>
          <span className={styles.pathSep}>/</span>
          <span>{shortName}</span>
        </Link>
      </div>
      <DashboardProjectAside
        orgSlug={orgSlug}
        slug={slug}
        stats={stats}
        loading={statsLoading}
      />
      <div className={styles.meta}>
        <span className={styles.updated} title={new Date(updatedAt).toLocaleString()}>
          {formatRelativeTimeFromIso(updatedAt)}
        </span>
      </div>
    </li>
  )
}
