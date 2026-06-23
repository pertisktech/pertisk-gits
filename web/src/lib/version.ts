export const builtAppVersion = import.meta.env.VITE_APP_VERSION

export async function fetchAppVersion(): Promise<string> {
  const response = await fetch('/health')
  if (!response.ok) {
    throw new Error('Health check unavailable')
  }

  const body = (await response.json()) as { version?: string }
  if (!body.version) {
    throw new Error('Version missing from health response')
  }

  return body.version
}
