import { ChevronRight, File, Folder } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  buildDiffFileTree,
  collectFolderPaths,
  diffFileAnchorId,
  fileStatusLabel,
  parseUnifiedDiff,
  type DiffFile,
  type DiffLine,
  type DiffTreeNode,
} from '../lib/unifiedDiff'
import { cn } from '../utils/cn'

export interface DiffLineRenderContext {
  file: DiffFile
  line: DiffLine
  index: number
}

interface DiffViewerProps {
  diff: string
  renderLineActions?: (context: DiffLineRenderContext) => ReactNode
  renderAfterLine?: (context: DiffLineRenderContext) => ReactNode
}

function ChangeStats({
  insertions,
  deletions,
  compact = false,
}: {
  insertions: number
  deletions: number
  compact?: boolean
}) {
  if (insertions === 0 && deletions === 0) return null

  return (
    <span className={cn('diff-view-stats', compact && 'diff-view-stats--compact')}>
      {insertions > 0 && <span className="diff-view-stats-add">+{insertions}</span>}
      {deletions > 0 && <span className="diff-view-stats-del">−{deletions}</span>}
    </span>
  )
}

function DiffTreeItem({
  node,
  depth,
  selectedPath,
  expanded,
  onToggle,
  onSelectFile,
}: {
  node: DiffTreeNode
  depth: number
  selectedPath: string | null
  expanded: Set<string>
  onToggle: (path: string) => void
  onSelectFile: (path: string) => void
}) {
  const isDir = node.type === 'dir'
  const isExpanded = isDir && expanded.has(node.fullPath)
  const isSelected = !isDir && selectedPath === node.fullPath

  return (
    <>
      <button
        type="button"
        className={cn('diff-view-tree-item', isSelected && 'diff-view-tree-item--active')}
        style={{ paddingLeft: `${0.75 + depth * 0.85}rem` }}
        onClick={() => {
          if (isDir) {
            onToggle(node.fullPath)
            return
          }
          onSelectFile(node.fullPath)
        }}
      >
        {isDir ? (
          <ChevronRight
            size={14}
            className={cn('diff-view-tree-chevron', isExpanded && 'diff-view-tree-chevron--open')}
          />
        ) : (
          <span className="diff-view-tree-spacer" />
        )}
        {isDir ? (
          <Folder size={14} className="diff-view-tree-icon" />
        ) : (
          <File size={14} className="diff-view-tree-icon" />
        )}
        <span className="diff-view-tree-name">{node.name}</span>
        <ChangeStats insertions={node.insertions} deletions={node.deletions} compact />
      </button>
      {isDir && isExpanded &&
        node.children.map((child) => (
          <DiffTreeItem
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            expanded={expanded}
            onToggle={onToggle}
            onSelectFile={onSelectFile}
          />
        ))}
    </>
  )
}

function DiffFilePanel({
  file,
  renderLineActions,
  renderAfterLine,
}: {
  file: DiffFile
  renderLineActions?: (context: DiffLineRenderContext) => ReactNode
  renderAfterLine?: (context: DiffLineRenderContext) => ReactNode
}) {
  return (
    <section id={diffFileAnchorId(file.path)} className="diff-view-file">
      <header className="diff-view-file-header">
        <div className="diff-view-file-path">
          {file.status === 'renamed' && file.oldPath ? (
            <>
              <span className="diff-view-file-old">{file.oldPath}</span>
              <span className="diff-view-file-arrow">→</span>
              <span>{file.path}</span>
            </>
          ) : (
            file.path
          )}
        </div>
        <div className="diff-view-file-meta">
          <span className={cn('diff-view-file-status', `diff-view-file-status--${file.status}`)}>
            {fileStatusLabel(file.status)}
          </span>
          <ChangeStats insertions={file.insertions} deletions={file.deletions} />
        </div>
      </header>

      <div className="diff-view-lines">
        {file.lines.map((line, index) => {
          const prefix =
            line.kind === 'hunk'
              ? ''
              : line.kind === 'add'
                ? '+'
                : line.kind === 'del'
                  ? '-'
                  : ' '

          return (
            <div key={`${file.path}:${index}`}>
              <div
                className={cn(
                  'diff-view-line',
                  renderLineActions && 'diff-view-line--with-actions',
                  line.kind === 'add' && 'diff-view-line--add',
                  line.kind === 'del' && 'diff-view-line--del',
                  line.kind === 'hunk' && 'diff-view-line--hunk',
                )}
              >
                <span className="diff-view-line-old">
                  {line.kind === 'del' || line.kind === 'ctx' || line.kind === 'hunk'
                    ? (line.oldLine ?? '')
                    : ''}
                </span>
                <span className="diff-view-line-new">
                  {line.kind === 'add' || line.kind === 'ctx' || line.kind === 'hunk'
                    ? (line.newLine ?? '')
                    : ''}
                </span>
                <span
                  className={cn(
                    'diff-view-line-text',
                    line.kind === 'add' && 'diff-view-line-text--add',
                    line.kind === 'del' && 'diff-view-line-text--del',
                  )}
                >
                  {line.kind === 'hunk' ? line.text : `${prefix}${line.text}`}
                </span>
                {renderLineActions?.({ file, line, index })}
              </div>
              {renderAfterLine?.({ file, line, index })}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function DiffViewer({ diff, renderLineActions, renderAfterLine }: DiffViewerProps) {
  const files = useMemo(() => parseUnifiedDiff(diff), [diff])
  const tree = useMemo(() => buildDiffFileTree(files), [files])
  const [selectedPath, setSelectedPath] = useState<string | null>(files[0]?.path ?? null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(collectFolderPaths(tree)))

  useEffect(() => {
    setSelectedPath(files[0]?.path ?? null)
    setExpanded(new Set(collectFolderPaths(tree)))
  }, [files, tree])

  const totalInsertions = files.reduce((sum, file) => sum + file.insertions, 0)
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0)

  const scrollToFile = (path: string) => {
    setSelectedPath(path)
    document.getElementById(diffFileAnchorId(path))?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  const toggleFolder = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  if (files.length === 0) {
    return diff.trim() ? <pre className="app-diff m-0">{diff}</pre> : null
  }

  return (
    <div className="diff-view">
      <aside className="diff-view-sidebar">
        <div className="diff-view-sidebar-header">
          <span>
            {files.length} file{files.length === 1 ? '' : 's'}
          </span>
          <ChangeStats insertions={totalInsertions} deletions={totalDeletions} />
        </div>
        <nav className="diff-view-tree" aria-label="Changed files">
          {tree.map((node) => (
            <DiffTreeItem
              key={node.id}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              expanded={expanded}
              onToggle={toggleFolder}
              onSelectFile={scrollToFile}
            />
          ))}
        </nav>
      </aside>

      <div className="diff-view-content">
        {files.map((file) => (
          <DiffFilePanel
            key={file.path}
            file={file}
            renderLineActions={renderLineActions}
            renderAfterLine={renderAfterLine}
          />
        ))}
      </div>
    </div>
  )
}
