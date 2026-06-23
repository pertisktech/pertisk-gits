import type { TreeEntry } from '../api/types'

const README_PRIORITY = [
  'README.md',
  'Readme.md',
  'readme.md',
  'README.MD',
  'README',
  'README.markdown',
  'readme.markdown',
]

export function findReadmePath(entries: TreeEntry[]): string | null {
  const files = entries.filter((entry) => entry.kind === 'blob')
  for (const name of README_PRIORITY) {
    const match = files.find((entry) => entry.name === name)
    if (match) return match.path
  }
  const fallback = files.find((entry) => /^readme(\.(md|markdown))?$/i.test(entry.name))
  return fallback?.path ?? null
}
