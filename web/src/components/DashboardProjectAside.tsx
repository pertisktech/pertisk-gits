import type { ReactNode } from 'react'
import { CircleDot, GitBranch, Loader2, Tag, Workflow } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { DashboardProjectStats } from '../api/types'
import { projectTabPath } from '../lib/projectRoute'
import { cn } from '../utils/cn'
import styles from '../pages/DashboardPage.module.css'
import { ActionsStatusIcon } from './PipelineStatus'

function StatLink({
  to,
  label,
  icon,
  value,
  loading,
  showCount,
}: {
  to: string
  label: string
  icon: ReactNode
  value: number
  loading?: boolean
  showCount: boolean
}) {
  const title = `${label}: ${value}`

  return (
    <Link
      to={to}
      className={cn(styles.stat, showCount && styles.statWithCount)}
      title={title}
      aria-label={title}
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin text-muted" aria-hidden />
      ) : (
        <>
          <span className={styles.statIcon} aria-hidden>
            {icon}
          </span>
          {showCount && <span className={styles.statValue}>{value}</span>}
        </>
      )}
    </Link>
  )
}

export function DashboardProjectAside({
  orgSlug,
  slug,
  visibility,
  stats,
  loading,
}: {
  orgSlug: string
  slug: string
  visibility: 'public' | 'private'
  stats?: DashboardProjectStats
  loading?: boolean
}) {
  const basePath = `/groups/${orgSlug}/projects/${slug}`
  const showCount = visibility !== 'private'

  return (
    <div className={styles.aside}>
      <div className={styles.stats}>
        <StatLink
          to={basePath}
          label="Branches"
          icon={<GitBranch size={14} />}
          value={stats?.branch_count ?? 0}
          loading={loading && !stats}
          showCount={showCount}
        />
        <StatLink
          to={projectTabPath(basePath, 'tags')}
          label="Tags"
          icon={<Tag size={14} />}
          value={stats?.tag_count ?? 0}
          loading={loading && !stats}
          showCount={showCount}
        />
        <StatLink
          to={projectTabPath(basePath, 'issues')}
          label="Open issues"
          icon={<CircleDot size={14} />}
          value={stats?.open_issue_count ?? 0}
          loading={loading && !stats}
          showCount={showCount}
        />
        {stats?.has_pipelines && (
          <Link
            to={projectTabPath(basePath, 'pipelines')}
            className={styles.stat}
            title={
              stats.latest_pipeline_status
                ? `Latest pipeline: ${stats.latest_pipeline_status}`
                : 'Pipelines'
            }
            aria-label={
              stats.latest_pipeline_status
                ? `Latest pipeline status: ${stats.latest_pipeline_status}`
                : 'Pipelines configured'
            }
          >
            <span className={styles.statIcon} aria-hidden>
              {stats.latest_pipeline_status ? (
                <ActionsStatusIcon status={stats.latest_pipeline_status} size="sm" />
              ) : (
                <Workflow size={14} />
              )}
            </span>
          </Link>
        )}
      </div>
    </div>
  )
}
