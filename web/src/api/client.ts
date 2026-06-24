import type {
  AuthResponse,
  CommitDetail,
  CommitInfo,
  CommitStatus,
  IssueCommentDetail,
  IssueDetail,
  Label,
  Milestone,
  Organization,
  OrgMember,
  PipelineConfigPreview,
  PipelineRun,
  PullRequestCommentDetail,
  PullRequestDetail,
  PullRequestReview,
  PullRequestReviewDetail,
  RegisterRunnerResponse,
  RepoBrowser,
  RepoCollaborator,
  Repository,
  RepositoryDetail,
  RotateRunnerTokenResponse,
  Runner,
  TreeEntry,
  User,
  UserSshKey,
} from './types'

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

  searchUsers: (token: string, q: string, limit = 20) => {
    const search = new URLSearchParams({ q, limit: String(limit) })
    return request<User[]>(`/users/search?${search}`, {}, token)
  },

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

  listOrganizationMembers: (token: string, orgSlug: string) =>
    request<OrgMember[]>(`/organizations/${orgSlug}/members`, {}, token),

  addOrganizationMember: (
    token: string,
    orgSlug: string,
    payload: { username?: string; user_id?: string; role?: 'owner' | 'admin' | 'member' },
  ) =>
    request<OrgMember>(`/organizations/${orgSlug}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  updateOrganizationMember: (
    token: string,
    orgSlug: string,
    userId: string,
    payload: { role: 'owner' | 'admin' | 'member' },
  ) =>
    request<OrgMember>(`/organizations/${orgSlug}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

  removeOrganizationMember: async (token: string, orgSlug: string, userId: string) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${API_BASE}/organizations/${orgSlug}/members/${userId}`, {
      method: 'DELETE',
      headers,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Request failed'
      throw new Error(message)
    }
  },

  listRepositoryCollaborators: (token: string, orgSlug: string, repoSlug: string) =>
    request<RepoCollaborator[]>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/collaborators`,
      {},
      token,
    ),

  addRepositoryCollaborator: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: { username?: string; user_id?: string; role?: 'admin' | 'write' | 'read' },
  ) =>
    request<RepoCollaborator>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/collaborators`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  updateRepositoryCollaborator: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    userId: string,
    payload: { role: 'admin' | 'write' | 'read' },
  ) =>
    request<RepoCollaborator>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/collaborators/${userId}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token,
    ),

  removeRepositoryCollaborator: async (
    token: string,
    orgSlug: string,
    repoSlug: string,
    userId: string,
  ) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(
      `${API_BASE}/organizations/${orgSlug}/repositories/${repoSlug}/collaborators/${userId}`,
      { method: 'DELETE', headers },
    )
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Request failed'
      throw new Error(message)
    }
  },

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

  listLabels: (orgSlug: string, repoSlug: string, token?: string | null) =>
    request<Label[]>(`/organizations/${orgSlug}/repositories/${repoSlug}/labels`, {}, token),

  createLabel: (token: string, orgSlug: string, repoSlug: string, payload: { name: string; color?: string; description?: string }) =>
    request<Label>(`/organizations/${orgSlug}/repositories/${repoSlug}/labels`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  listMilestones: (orgSlug: string, repoSlug: string, token?: string | null) =>
    request<Milestone[]>(`/organizations/${orgSlug}/repositories/${repoSlug}/milestones`, {}, token),

  createMilestone: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: { title: string; description?: string; due_on?: string },
  ) =>
    request<Milestone>(`/organizations/${orgSlug}/repositories/${repoSlug}/milestones`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  listIssues: (
    orgSlug: string,
    repoSlug: string,
    params?: { state?: string; label?: string; q?: string },
    token?: string | null,
  ) => {
    const search = new URLSearchParams()
    if (params?.state) search.set('state', params.state)
    if (params?.label) search.set('label', params.label)
    if (params?.q) search.set('q', params.q)
    const qs = search.toString()
    return request<{ issues: IssueDetail[]; open_count: number; closed_count: number }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/issues${qs ? `?${qs}` : ''}`,
      {},
      token,
    )
  },

  getIssue: (orgSlug: string, repoSlug: string, issueNumber: number, token?: string | null) =>
    request<IssueDetail>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/issues/${issueNumber}`,
      {},
      token,
    ),

  createIssue: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: {
      title: string
      body?: string
      assignee_id?: string | null
      milestone_id?: string | null
      label_ids?: string[]
    },
  ) =>
    request<IssueDetail>(`/organizations/${orgSlug}/repositories/${repoSlug}/issues`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  updateIssue: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    issueNumber: number,
    payload: {
      title?: string
      body?: string
      state?: 'open' | 'closed'
      assignee_id?: string | null
      milestone_id?: string | null
      label_ids?: string[]
    },
  ) =>
    request<IssueDetail>(`/organizations/${orgSlug}/repositories/${repoSlug}/issues/${issueNumber}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

  listIssueComments: (orgSlug: string, repoSlug: string, issueNumber: number, token?: string | null) =>
    request<IssueCommentDetail[]>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/issues/${issueNumber}/comments`,
      {},
      token,
    ),

  createIssueComment: (token: string, orgSlug: string, repoSlug: string, issueNumber: number, body: string) =>
    request<IssueCommentDetail>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/issues/${issueNumber}/comments`,
      { method: 'POST', body: JSON.stringify({ body }) },
      token,
    ),

  listPullRequests: (
    orgSlug: string,
    repoSlug: string,
    params?: { state?: string },
    token?: string | null,
  ) => {
    const search = new URLSearchParams()
    if (params?.state) search.set('state', params.state)
    const qs = search.toString()
    return request<{ pull_requests: PullRequestDetail[]; open_count: number; closed_count: number }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pulls${qs ? `?${qs}` : ''}`,
      {},
      token,
    )
  },

  getPullRequest: (orgSlug: string, repoSlug: string, pullNumber: number, token?: string | null) =>
    request<PullRequestDetail>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pulls/${pullNumber}`,
      {},
      token,
    ),

  createPullRequest: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: { title: string; body?: string; source_branch: string; target_branch: string },
  ) =>
    request<PullRequestDetail>(`/organizations/${orgSlug}/repositories/${repoSlug}/pulls`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  mergePullRequest: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    pullNumber: number,
    payload?: { merge_strategy?: 'merge' | 'squash' },
  ) =>
    request<{ merge_commit_sha: string; pull_request: PullRequestDetail['pull_request'] }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pulls/${pullNumber}/merge`,
      { method: 'POST', body: JSON.stringify(payload ?? {}) },
      token,
    ),

  listPullRequestComments: (orgSlug: string, repoSlug: string, pullNumber: number, token?: string | null) =>
    request<PullRequestCommentDetail[]>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pulls/${pullNumber}/comments`,
      {},
      token,
    ),

  createPullRequestComment: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    pullNumber: number,
    payload: { body: string; path?: string; line?: number },
  ) =>
    request<PullRequestCommentDetail>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pulls/${pullNumber}/comments`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  listPullRequestReviews: (orgSlug: string, repoSlug: string, pullNumber: number, token?: string | null) =>
    request<PullRequestReviewDetail[]>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pulls/${pullNumber}/reviews`,
      {},
      token,
    ),

  createPullRequestReview: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    pullNumber: number,
    payload: { state: 'approved' | 'changes_requested' | 'commented'; body?: string },
  ) =>
    request<{ review: PullRequestReview; reviewer: User }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pulls/${pullNumber}/reviews`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  listPipelineRuns: (token: string, orgSlug: string, repoSlug: string) =>
    request<PipelineRun[]>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pipelines`,
      {},
      token,
    ),

  getPipelineRun: (token: string, orgSlug: string, repoSlug: string, runId: string) =>
    request<PipelineRun>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pipelines/${runId}`,
      {},
      token,
    ),

  getPipelineConfig: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    ref?: string,
  ) =>
    request<PipelineConfigPreview>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pipelines/config${
        ref ? `?ref=${encodeURIComponent(ref)}` : ''
      }`,
      {},
      token,
    ),

  triggerPipeline: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: { commit_sha: string; ref_name: string; event_type?: string },
  ) =>
    request<PipelineRun>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pipelines/trigger`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  rerunPipeline: (token: string, orgSlug: string, repoSlug: string, runId: string) =>
    request<PipelineRun>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pipelines/${runId}/rerun`,
      { method: 'POST' },
      token,
    ),

  listCommitStatuses: (
    orgSlug: string,
    repoSlug: string,
    commitSha: string,
    token?: string | null,
  ) =>
    request<CommitStatus[]>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/commits/${commitSha}/statuses`,
      {},
      token,
    ),

  listRunners: (token: string) => request<Runner[]>('/runners', {}, token),

  registerRunner: (token: string, payload: { name: string; labels?: string[] }) =>
    request<RegisterRunnerResponse>('/runners/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  deleteRunner: async (token: string, runnerId: string) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${API_BASE}/runners/${runnerId}`, {
      method: 'DELETE',
      headers,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Request failed'
      throw new Error(message)
    }
  },

  rotateRunnerToken: (token: string, runnerId: string) =>
    request<RotateRunnerTokenResponse>(`/runners/${runnerId}/rotate-token`, {
      method: 'POST',
      body: JSON.stringify({}),
    }, token),
}
