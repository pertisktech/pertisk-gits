/** Fallback when discover has not run yet; API returns the live limit. */
export const DEFAULT_IMPORT_MAX_REPOS_PER_JOB = 500

export function chunkImportRepos<T>(items: T[], maxPerJob: number): T[][] {
  if (maxPerJob <= 0 || items.length <= maxPerJob) return items.length ? [items] : []
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += maxPerJob) {
    chunks.push(items.slice(i, i + maxPerJob))
  }
  return chunks
}
