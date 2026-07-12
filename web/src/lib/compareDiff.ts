import type { DiffFile } from './unifiedDiff'

export function fileToUnifiedDiff(file: DiffFile): string {
  const oldPath = file.oldPath ?? file.path
  const newPath = file.path
  const lines: string[] = [
    `diff --git a/${oldPath} b/${newPath}`,
  ]

  if (file.status === 'added') {
    lines.push('new file mode 100644')
    lines.push('--- /dev/null')
    lines.push(`+++ b/${newPath}`)
  } else if (file.status === 'deleted') {
    lines.push('deleted file mode 100644')
    lines.push(`--- a/${oldPath}`)
    lines.push('+++ /dev/null')
  } else if (file.status === 'renamed') {
    lines.push(`rename from ${oldPath}`)
    lines.push(`rename to ${newPath}`)
    lines.push(`--- a/${oldPath}`)
    lines.push(`+++ b/${newPath}`)
  } else {
    lines.push(`--- a/${oldPath}`)
    lines.push(`+++ b/${newPath}`)
  }

  for (const line of file.lines) {
    if (line.kind === 'hunk') lines.push(line.text)
    else if (line.kind === 'add') lines.push(`+${line.text}`)
    else if (line.kind === 'del') lines.push(`-${line.text}`)
    else lines.push(` ${line.text}`)
  }

  return lines.join('\n')
}
