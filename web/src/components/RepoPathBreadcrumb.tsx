import { ChevronRight } from 'lucide-react'
import { RepoEntryIcon } from './RepoEntryIcon'

interface RepoPathBreadcrumbProps {
  /** Current folder path (no trailing file). */
  folderPath: string
  /** When set, show full path ending with this file name. */
  filePath?: string | null
  onNavigateFolder: (path: string) => void
}

export function RepoPathBreadcrumb({
  folderPath,
  filePath,
  onNavigateFolder,
}: RepoPathBreadcrumbProps) {
  const parts = filePath ? filePath.split('/') : folderPath ? folderPath.split('/') : []
  const folderParts = filePath ? parts.slice(0, -1) : parts
  const fileName = filePath ? parts[parts.length - 1] : null

  if (parts.length === 0 && !fileName) {
    return (
      <div className="app-path-crumb flex-1 min-w-0">
        <button type="button" onClick={() => onNavigateFolder('')} aria-label="Repository root">
          /
        </button>
      </div>
    )
  }

  return (
    <div className="app-path-crumb flex-1 min-w-0">
      <button type="button" onClick={() => onNavigateFolder('')} aria-label="Repository root">
        /
      </button>
      {folderParts.map((part, i) => {
        const subPath = folderParts.slice(0, i + 1).join('/')
        return (
          <span key={subPath} className="inline-flex items-center gap-1 min-w-0">
            <ChevronRight size={12} className="text-muted shrink-0" />
            <button type="button" className="truncate max-w-[10rem]" onClick={() => onNavigateFolder(subPath)}>
              {part}
            </button>
          </span>
        )
      })}
      {fileName && (
        <span className="inline-flex items-center gap-1 min-w-0 text-text">
          <ChevronRight size={12} className="text-muted shrink-0" />
          <RepoEntryIcon name={fileName} kind="blob" size="sm" />
          <span className="font-medium truncate">{fileName}</span>
        </span>
      )}
    </div>
  )
}
