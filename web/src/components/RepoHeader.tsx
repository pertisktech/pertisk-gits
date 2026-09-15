import type { ReactNode } from 'react'
import { displayRepoName } from '../lib/projectInitial'
import { Badge, RepoIcon } from './primitives'
import styles from './RepoHeader.module.css'

interface RepoHeaderProps {
  readonly orgPath: string
  readonly repoName: string
  readonly repoSlug: string
  readonly description?: string | null
  readonly visibility?: 'public' | 'private'
  readonly action?: ReactNode
}

export function RepoHeader({
  orgPath,
  repoName,
  repoSlug,
  description,
  visibility,
  action,
}: RepoHeaderProps) {
  const title = displayRepoName(repoName, repoSlug)

  return (
    <div className={`${styles.header} flex flex-wrap items-start justify-between gap-3`}>
      <div className={`${styles.main} flex items-start gap-3 min-w-0`}>
        <RepoIcon name={title} className={styles.iconLg} />
        <div className="min-w-0">
          <h1 className={styles.title}>
            <span>{title}</span>
            {visibility && (
              <Badge variant={visibility === 'private' ? 'warning' : 'success'} className="ml-1">
                {visibility}
              </Badge>
            )}
          </h1>
          <p className={styles.description}>
            <span className="font-mono text-muted text-xs">
              {orgPath}/{repoSlug}
            </span>
          </p>
          {description && <p className={styles.description}>{description}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}
