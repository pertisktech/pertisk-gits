import { FolderGit2, FolderTree, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Organization } from '../api/types'
import { groupBaseUrl, groupUrlPath } from '../lib/groupPath'
import { projectInitial } from '../lib/projectInitial'
import { cn } from '../utils/cn'
import styles from './ProjectList.module.css'

function GroupStat({
  icon,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode
  label: string
  value: number
  loading?: boolean
}) {
  const title = `${value} ${label}`

  return (
    <span className={cn(styles.stat, styles.statWithCount)} title={title} aria-label={title}>
      {loading ? (
        <Loader2 size={14} className="animate-spin text-muted" aria-hidden />
      ) : (
        <>
          <span className={styles.statIcon} aria-hidden>
            {icon}
          </span>
          <span className={styles.statValue}>{value}</span>
        </>
      )}
    </span>
  )
}

export function GroupListRow({
  group,
  subgroupCount,
  projectCount,
  statsLoading,
}: {
  group: Organization
  subgroupCount: number
  projectCount: number
  statsLoading?: boolean
}) {
  const path = groupUrlPath(group)

  return (
    <li className={styles.row}>
      <div className={styles.icon} aria-hidden>
        <span className={styles.iconLetter}>{projectInitial(group.name, group.slug)}</span>
      </div>
      <div className={styles.main}>
        <Link to={groupBaseUrl(group)} className={styles.pathLink}>
          {group.name}
        </Link>
        <div className="text-xs text-muted font-mono mt-0.5">{path}</div>
        {group.description && (
          <p className="text-sm text-text-secondary mt-1 mb-0 line-clamp-2">{group.description}</p>
        )}
      </div>
      <div className={styles.meta}>
        <div className={styles.stats}>
          <GroupStat
            icon={<FolderTree size={14} />}
            label="subgroups"
            value={subgroupCount}
            loading={statsLoading}
          />
          <GroupStat
            icon={<FolderGit2 size={14} />}
            label="projects"
            value={projectCount}
            loading={statsLoading}
          />
        </div>
      </div>
    </li>
  )
}
