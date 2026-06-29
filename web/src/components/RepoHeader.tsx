import type { ReactNode } from 'react'
import { displayRepoName, projectInitial } from '../lib/projectInitial'
import { StatusBadge, visibilityVariant } from './StatusBadge'
import styles from './RepoHeader.module.css'

export function RepoHeader({
  repoName,
  repoSlug,
  description,
  visibility,
  action,
}: {
  repoName: string
  repoSlug: string
  description?: string | null
  visibility?: 'public' | 'private'
  action?: ReactNode
}) {
  const title = displayRepoName(repoName, repoSlug)

  return (
    <div className={`${styles.header} flex flex-wrap items-start justify-between gap-3`}>
      <div className={`${styles.main} flex items-start gap-3 min-w-0`}>
        <div className={styles.icon} aria-hidden>
          <span className={styles.iconLetter}>{projectInitial(title, repoSlug)}</span>
        </div>
        <div className="min-w-0">
          <h1 className={styles.title}>
            <span>{title}</span>
            {visibility && (
              <StatusBadge variant={visibilityVariant(visibility)} className="ml-1">
                {visibility}
              </StatusBadge>
            )}
          </h1>
          {description && <p className={styles.description}>{description}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}
