import { Link } from 'react-router-dom'
import { StatusBadge, visibilityVariant } from './StatusBadge'
import { EntityHeader } from './ui/EntityHeader'
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
    <EntityHeader
      title={
        <>
          <Link
            to={`/groups/${orgSlug}`}
            className="text-brand-500 hover:text-brand-600 no-underline"
          >
            {orgName}
          </Link>
          <span className="font-normal text-gray-400 dark:text-gray-500">/</span>
          <span>{repoName}</span>
        </>
      }
      description={description}
      badge={
        visibility ? (
          <StatusBadge variant={visibilityVariant(visibility)}>{visibility}</StatusBadge>
        ) : undefined
      }
      actions={action}
    />
  )
}
