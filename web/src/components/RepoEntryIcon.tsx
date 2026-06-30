import { Folder, FolderOpen } from 'lucide-react'
import type { CSSProperties } from 'react'
import { getFileIconStyle } from '../lib/fileIcon'
import { cn } from '../utils/cn'

export function RepoEntryIcon({
  name,
  kind,
  expanded = false,
  size = 'md',
  className,
}: {
  name: string
  kind: 'tree' | 'blob' | string
  expanded?: boolean
  size?: 'sm' | 'md'
  className?: string
}) {
  if (kind === 'tree') {
    const Icon = expanded ? FolderOpen : Folder
    return (
      <Icon
        size={size === 'sm' ? 14 : 16}
        className={cn('repo-entry-icon repo-entry-icon--folder', className)}
        aria-hidden
      />
    )
  }

  const style = getFileIconStyle(name)

  return (
    <span
      className={cn('repo-entry-icon repo-entry-icon--file', size === 'sm' && 'repo-entry-icon--sm', className)}
      style={
        {
          '--repo-file-icon-color': style.color,
          '--repo-file-icon-bg': style.bg,
        } as CSSProperties
      }
      aria-hidden
    >
      <span className="repo-entry-icon-label">{style.label}</span>
    </span>
  )
}
