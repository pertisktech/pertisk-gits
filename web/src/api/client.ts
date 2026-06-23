import type { AuthResponse, CommitInfo, Organization, RepoBrowser, Repository, RepositoryDetail, TreeEntry, User } from './types'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers })
  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Request failed'
    throw new Error(message)
  }

  return body as T
}

export const api = {
  register: (payload: {
    username: string
    email: string
    password: string
    display_name?: string
  }) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { login: string; password: string }) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  me: (token: string) => request<{ user: User }>('/me', {}, token),

  listOrganizations: (token: string) =>
    request<Organization[]>('/organizations', {}, token),

  createOrganization: (
    token: string,
    payload: { name: string; slug: string; description?: string },
  ) =>
    request<Organization>('/organizations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  listRepositories: (token: string, orgSlug: string) =>
    request<Repository[]>(`/organizations/${orgSlug}/repositories`, {}, token),

  createRepository: (
    token: string,
    orgSlug: string,
    payload: { name: string; slug: string; description?: string; visibility?: 'public' | 'private' },
  ) =>
    request<Repository>(`/organizations/${orgSlug}/repositories`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  getRepository: (token: string, orgSlug: string, repoSlug: string) =>
    request<RepositoryDetail>(`/organizations/${orgSlug}/repositories/${repoSlug}`, {}, token),

  getRepoBrowser: (token: string, orgSlug: string, repoSlug: string) =>
    request<{ browser: RepoBrowser }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/browser`,
      {},
      token,
    ),

  getRepoTree: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    params: { ref: string; path?: string },
  ) => {
    const search = new URLSearchParams({ ref: params.ref })
    if (params.path) search.set('path', params.path)
    return request<{ entries: TreeEntry[]; path: string; ref: string }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/tree?${search}`,
      {},
      token,
    )
  },

  getRepoBlob: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    params: { ref: string; path: string },
  ) => {
    const search = new URLSearchParams({ ref: params.ref, path: params.path })
    return request<{ path: string; ref: string; content: string; is_binary: boolean }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/blob?${search}`,
      {},
      token,
    )
  },

  getRepoCommits: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    params: { ref: string; limit?: number },
  ) => {
    const search = new URLSearchParams({ ref: params.ref })
    if (params.limit) search.set('limit', String(params.limit))
    return request<{ commits: CommitInfo[]; ref: string }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/commits?${search}`,
      {},
      token,
    )
  },
}
