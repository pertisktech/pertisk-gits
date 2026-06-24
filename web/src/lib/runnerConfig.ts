export function formatRunnerConf(token: string, apiUrl: string): string {
  return `PERTISK_RUNNER_TOKEN=${token}
PERTISK_API_URL=${apiUrl}
# Optional — omit on remote runners; workspace is fetched from the API
PERTISK_REPOS_ROOT=/var/lib/pertisk-gits/repos`
}

/** Runner API URL from server config (`GIT_PUBLIC_BASE_URL`), via `/health`. */
export async function fetchRunnerApiUrl(): Promise<string> {
  const response = await fetch('/health')
  if (!response.ok) {
    throw new Error('Health check unavailable')
  }

  const body = (await response.json()) as { api_url?: string }
  return body.api_url ?? window.location.origin
}
