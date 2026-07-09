import { Link } from 'react-router-dom'
import type { DashboardProjectStats } from '../api/types'
import { displayRepoName, projectInitial } from '../lib/projectInitial'
import { repositoryActivityAt } from '../lib/repositoryActivity'
import { formatRelativeTimeFromIso } from '../lib/relativeTime'
import { cn } from '../utils/cn'
import { DashboardProjectAside } from './DashboardProjectAside'
import styles from './ProjectList.module.css'

export function ProjectListRow({
  orgSlug,
  orgName,
  slug,
  name,
  updatedAt,
  lastCommitAt,
  stats,
  statsLoading,
  showFullPath = false,
  displayLabel,
}: Readonly<{
  orgSlug: string
  orgName?: string
  slug: string
  name: string
  updatedAt: string
  lastCommitAt?: string | null
  stats?: DashboardProjectStats
  statsLoading?: boolean
  showFullPath?: boolean
  displayLabel?: string
}>) {
  const shortName = displayRepoName(name, slug)
  const displayText = displayLabel ?? (showFullPath ? `${orgName ?? orgSlug}/${shortName}` : shortName)
  const activityAt = repositoryActivityAt({
    last_commit_at: lastCommitAt,
    updated_at: updatedAt,
  })

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
          <span>{displayText}</span>
        </Link>
      </div>
      <DashboardProjectAside
        orgSlug={orgSlug}
        slug={slug}
        stats={stats}
        loading={statsLoading}
      />
      <div className={styles.meta}>
        <span className={styles.updated} title={new Date(activityAt).toLocaleString()}>
          {formatRelativeTimeFromIso(activityAt)}
        </span>
      </div>
    </li>
  )
}
