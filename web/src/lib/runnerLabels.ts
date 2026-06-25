/** Parse comma-separated runner labels from registration form input. */
export function parseRunnerLabels(input: string): string[] {
  const seen = new Set<string>()
  const labels: string[] = []
  for (const part of input.split(',')) {
    const label = part.trim()
    if (!label || seen.has(label)) continue
    seen.add(label)
    labels.push(label)
  }
  return labels
}
