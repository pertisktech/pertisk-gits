import { Link } from 'react-router-dom'
import { StatusBadge, visibilityVariant } from './StatusBadge'
import type { ReactNode } from 'react'

export function RepoHeader({
  orgName,
  orgSlug,
  repoName,
  description,
  visibility,
  action,
}: {
  orgName: string
  orgSlug: string
  repoName: string
  description?: string | null
  visibility?: 'public' | 'private'
  action?: ReactNode
}) {
  return (
    <div className="gogs-repo-header flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="gogs-repo-title">
          <Link to={`/groups/${orgSlug}`}>{orgName}</Link>
          <span className="sep">/</span>
          <span>{repoName}</span>
          {visibility && (
            <StatusBadge variant={visibilityVariant(visibility)} className="ml-1">
              {visibility}
            </StatusBadge>
          )}
        </h1>
        {description && <p className="gogs-repo-desc">{description}</p>}
      </div>
      {action}
    </div>
  )
}
