export type DiffLineKind = 'hunk' | 'add' | 'del' | 'ctx'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  oldLine?: number
  newLine?: number
}

export type DiffFileStatus = 'added' | 'deleted' | 'modified' | 'renamed'

export interface DiffFile {
  path: string
  oldPath?: string
  status: DiffFileStatus
  insertions: number
  deletions: number
  lines: DiffLine[]
}

export interface DiffTreeNode {
  id: string
  name: string
  type: 'dir' | 'file'
  fullPath: string
  file?: DiffFile
  children: DiffTreeNode[]
  insertions: number
  deletions: number
}

export function diffFileAnchorId(path: string): string {
  return `diff-file-${path.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  let newLine = 0
  let oldLine = 0

  const pushCurrent = () => {
    if (current?.path) {
      files.push(current)
    }
  }

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      pushCurrent()
      const match = raw.match(/^diff --git a\/(.+) b\/(.+)$/)
      const oldPath = match?.[1] ?? ''
      const newPath = match?.[2] ?? ''
      current = {
        path: newPath || oldPath,
        oldPath: oldPath && newPath && oldPath !== newPath ? oldPath : undefined,
        status: 'modified',
        insertions: 0,
        deletions: 0,
        lines: [],
      }
      continue
    }
    if (!current) continue

    if (raw.startsWith('new file mode')) {
      current.status = 'added'
      continue
    }
    if (raw.startsWith('deleted file mode')) {
      current.status = 'deleted'
      continue
    }
    if (raw.startsWith('rename from ')) {
      current.oldPath = raw.slice('rename from '.length)
      current.status = 'renamed'
      continue
    }
    if (raw.startsWith('rename to ')) {
      current.path = raw.slice('rename to '.length)
      continue
    }
    if (raw.startsWith('+++ b/')) {
      const path = raw.slice(6)
      if (path !== '/dev/null') current.path = path
      continue
    }
    if (raw.startsWith('--- a/')) {
      const path = raw.slice(6)
      if (path !== '/dev/null' && !current.oldPath) {
        current.oldPath = path
      }
      continue
    }
    if (raw.startsWith('Binary files ')) {
      current.lines.push({ kind: 'ctx', text: raw })
      continue
    }
    if (raw.startsWith('@@')) {
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/)
      oldLine = match ? Number.parseInt(match[1], 10) : 0
      newLine = match ? Number.parseInt(match[2], 10) : 0
      current.lines.push({ kind: 'hunk', text: raw, oldLine, newLine })
      continue
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      current.lines.push({ kind: 'add', text: raw.slice(1), newLine })
      current.insertions += 1
      newLine += 1
      continue
    }
    if (raw.startsWith('-') && !raw.startsWith('---')) {
      current.lines.push({ kind: 'del', text: raw.slice(1), oldLine })
      current.deletions += 1
      oldLine += 1
      continue
    }
    if (raw.startsWith(' ')) {
      current.lines.push({ kind: 'ctx', text: raw.slice(1), oldLine, newLine })
      oldLine += 1
      newLine += 1
    }
  }

  pushCurrent()
  return files
}

function sortTree(nodes: DiffTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const node of nodes) {
    if (node.type === 'dir') sortTree(node.children)
  }
}

function bubbleStats(nodes: DiffTreeNode[]): void {
  for (const node of nodes) {
    if (node.type === 'dir') {
      bubbleStats(node.children)
      node.insertions = node.children.reduce((sum, child) => sum + child.insertions, 0)
      node.deletions = node.children.reduce((sum, child) => sum + child.deletions, 0)
    }
  }
}

export function buildDiffFileTree(files: DiffFile[]): DiffTreeNode[] {
  const root: DiffTreeNode[] = []

  for (const file of files) {
    const parts = file.path.split('/')
    let siblings = root

    for (let index = 0; index < parts.length; index += 1) {
      const isFile = index === parts.length - 1
      const name = parts[index]
      const fullPath = parts.slice(0, index + 1).join('/')
      const type = isFile ? 'file' : 'dir'

      let node = siblings.find((item) => item.name === name && item.type === type)
      if (!node) {
        node = {
          id: fullPath,
          name,
          type,
          fullPath,
          children: [],
          insertions: 0,
          deletions: 0,
          file: isFile ? file : undefined,
        }
        siblings.push(node)
      }

      if (isFile) {
        node.file = file
        node.insertions = file.insertions
        node.deletions = file.deletions
      }

      siblings = node.children
    }
  }

  bubbleStats(root)
  sortTree(root)
  return root
}

export function collectFolderPaths(nodes: DiffTreeNode[]): string[] {
  const paths: string[] = []
  const walk = (items: DiffTreeNode[]) => {
    for (const item of items) {
      if (item.type === 'dir') {
        paths.push(item.fullPath)
        walk(item.children)
      }
    }
  }
  walk(nodes)
  return paths
}

export function fileStatusLabel(status: DiffFileStatus): string {
  switch (status) {
    case 'added':
      return 'Added'
    case 'deleted':
      return 'Deleted'
    case 'renamed':
      return 'Renamed'
    default:
      return 'Modified'
  }
}
