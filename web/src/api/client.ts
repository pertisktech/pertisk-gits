import type { AuthResponse, CommitDetail, CommitInfo, Organization, RepoBrowser, Repository, RepositoryDetail, TreeEntry, User, UserSshKey } from './types'

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

  listSshKeys: (token: string) => request<UserSshKey[]>('/me/ssh-keys', {}, token),

  createSshKey: (token: string, payload: { title: string; public_key: string }) =>
    request<UserSshKey>('/me/ssh-keys', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  deleteSshKey: async (token: string, keyId: string) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${API_BASE}/me/ssh-keys/${keyId}`, {
      method: 'DELETE',
      headers,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Request failed'
      throw new Error(message)
    }
  },

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

  getRepository: (orgSlug: string, repoSlug: string, token?: string | null) =>
    request<RepositoryDetail>(`/organizations/${orgSlug}/repositories/${repoSlug}`, {}, token),

  updateRepository: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: {
      name?: string
      description?: string
      visibility?: 'public' | 'private'
      default_branch?: string
    },
  ) =>
    request<RepositoryDetail>(`/organizations/${orgSlug}/repositories/${repoSlug}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

  getRepoBrowser: (orgSlug: string, repoSlug: string, token?: string | null) =>
    request<{ browser: RepoBrowser }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/browser`,
      {},
      token,
    ),

  getRepoTree: (
    orgSlug: string,
    repoSlug: string,
    params: { ref: string; path?: string; ref_kind?: 'branch' | 'tag' },
    token?: string | null,
  ) => {
    const search = new URLSearchParams({ ref: params.ref })
    if (params.path) search.set('path', params.path)
    if (params.ref_kind) search.set('ref_kind', params.ref_kind)
    return request<{ entries: TreeEntry[]; path: string; ref: string }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/tree?${search}`,
      {},
      token,
    )
  },

  getRepoBlob: (
    orgSlug: string,
    repoSlug: string,
    params: { ref: string; path: string; ref_kind?: 'branch' | 'tag' },
    token?: string | null,
  ) => {
    const search = new URLSearchParams({ ref: params.ref, path: params.path })
    if (params.ref_kind) search.set('ref_kind', params.ref_kind)
    return request<{ path: string; ref: string; content: string; is_binary: boolean }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/blob?${search}`,
      {},
      token,
    )
  },

  repoRawUrl: (
    orgSlug: string,
    repoSlug: string,
    params: { ref: string; path: string; ref_kind?: 'branch' | 'tag' },
  ) => {
    const search = new URLSearchParams({ ref: params.ref, path: params.path })
    if (params.ref_kind) search.set('ref_kind', params.ref_kind)
    return `${API_BASE}/organizations/${orgSlug}/repositories/${repoSlug}/raw?${search}`
  },

  repoArchiveUrl: (
    orgSlug: string,
    repoSlug: string,
    params: { ref: string; ref_kind?: 'branch' | 'tag' },
  ) => {
    const search = new URLSearchParams({ ref: params.ref })
    if (params.ref_kind) search.set('ref_kind', params.ref_kind)
    return `${API_BASE}/organizations/${orgSlug}/repositories/${repoSlug}/archive?${search}`
  },

  getRepoCommits: (
    orgSlug: string,
    repoSlug: string,
    params: { ref: string; limit?: number; ref_kind?: 'branch' | 'tag' },
    token?: string | null,
  ) => {
    const search = new URLSearchParams({ ref: params.ref })
    if (params.limit) search.set('limit', String(params.limit))
    if (params.ref_kind) search.set('ref_kind', params.ref_kind)
    return request<{ commits: CommitInfo[]; ref: string }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/commits?${search}`,
      {},
      token,
    )
  },

  getRepoCommit: (orgSlug: string, repoSlug: string, commitSha: string, token?: string | null) =>
    request<{ commit: CommitDetail }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/commits/${commitSha}`,
      {},
      token,
    ),
}
