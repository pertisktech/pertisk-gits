import type {
  AdminConfiguration,
  AdminHealth,
  AdminSystemInfo,
  BackupComponentId,
  BackupJob,
  BackupOverview,
  AdminUser,
  AuthResponse,
  RegisterResponse,
  RegistrationInfo,
  CommitDetail,
  CommitInfo,
  CommitStatus,
  IssueCommentDetail,
  IssueDetail,
  Label,
  Milestone,
  CustomRolePermissions,
  OrganizationCustomRole,
  Organization,
  OrgMember,
  RepositoryTeamAccess,
  TeamDetail,
  TeamMemberEntry,
  TeamRepositoryAccess,
  TeamSummary,
  PipelineConfigPreview,
  PipelineMigrateResponse,
  PipelineRun,
  PullRequestCommentDetail,
  PullRequestDetail,
  PullRequestReview,
  PullRequestReviewDetail,
  ImportCredential,
  ImportJob,
  ImportJobDetail,
  RemoteNamespace,
  RemoteRepo,
  RegisterRunnerResponse,
  RepoBrowser,
  RepoCollaborator,
  BranchProtectionRule,
  RepositoryDeployKey,
  Repository,
  RepositoryDetail,
  RotateRunnerTokenResponse,
  Runner,
  ContainerImageDetail,
  ContainerImageSummary,
  RegistryGcReport,
  TreeEntry,
  User,
  UserSshKey,
  CodeSearchResponse,
  CodeSearchStatus,
  WikiPageDetail,
  WikiPageSummary,
  WikiRevisionDetail,
  WikiRevisionSummary,
  ApiTokenSummary,
  CreateMachineUserResponse,
  GitOpsWebhookSummary,
  MachineUserSummary,
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
    request<RegisterResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getRegistrationInfo: () => request<RegistrationInfo>('/auth/registration'),

  login: (payload: { login: string; password: string }) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  me: (token: string) =>
    request<{ user: User; is_super_admin: boolean }>('/me', {}, token),

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

  listApiTokens: (token: string) => request<ApiTokenSummary[]>('/me/tokens', {}, token),

  createApiToken: (token: string, payload: { name: string; scopes?: string[] }) =>
    request<{ token: ApiTokenSummary; plaintext: string }>(
      '/me/tokens',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  deleteApiToken: async (token: string, tokenId: string) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${API_BASE}/me/tokens/${tokenId}`, {
      method: 'DELETE',
      headers,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Request failed'
      throw new Error(message)
    }
  },

  listMachineUsers: (token: string, orgSlug: string) =>
    request<MachineUserSummary[]>(`/organizations/${orgSlug}/machine-users`, {}, token),

  createMachineUser: (
    token: string,
    orgSlug: string,
    payload: {
      username: string
      display_name?: string
      token_name: string
      scopes?: string[]
      role?: 'owner' | 'admin' | 'member'
    },
  ) =>
    request<CreateMachineUserResponse>(
      `/organizations/${orgSlug}/machine-users`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  listRepoGitOpsWebhooks: (token: string, orgSlug: string, repoSlug: string) =>
    request<GitOpsWebhookSummary[]>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/gitops-webhooks`,
      {},
      token,
    ),

  createRepoGitOpsWebhook: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: { name: string; url: string; provider?: string },
  ) =>
    request<GitOpsWebhookSummary>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/gitops-webhooks`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  deleteRepoGitOpsWebhook: async (
    token: string,
    orgSlug: string,
    repoSlug: string,
    webhookId: string,
  ) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(
      `${API_BASE}/organizations/${orgSlug}/repositories/${repoSlug}/gitops-webhooks/${webhookId}`,
      { method: 'DELETE', headers },
    )
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
    payload: {
      username?: string
      user_id?: string
      role?: 'owner' | 'admin' | 'member'
      custom_role_id?: string | null
    },
  ) =>
    request<OrgMember>(`/organizations/${orgSlug}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  updateOrganizationMember: (
    token: string,
    orgSlug: string,
    userId: string,
    payload: { role: 'owner' | 'admin' | 'member'; custom_role_id?: string | null },
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

  listCustomRoles: (token: string, orgSlug: string) =>
    request<OrganizationCustomRole[]>(`/organizations/${orgSlug}/custom-roles`, {}, token),

  createCustomRole: (
    token: string,
    orgSlug: string,
    payload: {
      name: string
      slug?: string
      description?: string
      permissions: CustomRolePermissions
    },
  ) =>
    request<OrganizationCustomRole>(`/organizations/${orgSlug}/custom-roles`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  updateCustomRole: (
    token: string,
    orgSlug: string,
    roleSlug: string,
    payload: {
      name?: string
      description?: string
      permissions?: CustomRolePermissions
    },
  ) =>
    request<OrganizationCustomRole>(`/organizations/${orgSlug}/custom-roles/${roleSlug}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

  deleteCustomRole: async (token: string, orgSlug: string, roleSlug: string) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${API_BASE}/organizations/${orgSlug}/custom-roles/${roleSlug}`, {
      method: 'DELETE',
      headers,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Request failed'
      throw new Error(message)
    }
  },

  listTeams: (token: string, orgSlug: string) =>
    request<TeamSummary[]>(`/organizations/${orgSlug}/teams`, {}, token),

  createTeam: (
    token: string,
    orgSlug: string,
    payload: { name: string; slug?: string; description?: string },
  ) =>
    request<TeamDetail>(`/organizations/${orgSlug}/teams`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  getTeam: (token: string, orgSlug: string, teamSlug: string) =>
    request<TeamDetail>(`/organizations/${orgSlug}/teams/${teamSlug}`, {}, token),

  updateTeam: (
    token: string,
    orgSlug: string,
    teamSlug: string,
    payload: { name?: string; description?: string },
  ) =>
    request<TeamDetail>(`/organizations/${orgSlug}/teams/${teamSlug}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

  deleteTeam: async (token: string, orgSlug: string, teamSlug: string) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${API_BASE}/organizations/${orgSlug}/teams/${teamSlug}`, {
      method: 'DELETE',
      headers,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Request failed'
      throw new Error(message)
    }
  },

  listTeamMembers: (token: string, orgSlug: string, teamSlug: string) =>
    request<TeamMemberEntry[]>(`/organizations/${orgSlug}/teams/${teamSlug}/members`, {}, token),

  addTeamMember: (
    token: string,
    orgSlug: string,
    teamSlug: string,
    payload: { username?: string; user_id?: string },
  ) =>
    request<TeamMemberEntry>(`/organizations/${orgSlug}/teams/${teamSlug}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  removeTeamMember: async (token: string, orgSlug: string, teamSlug: string, userId: string) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(
      `${API_BASE}/organizations/${orgSlug}/teams/${teamSlug}/members/${userId}`,
      { method: 'DELETE', headers },
    )
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Request failed'
      throw new Error(message)
    }
  },

  listTeamRepositories: (token: string, orgSlug: string, teamSlug: string) =>
    request<TeamRepositoryAccess[]>(
      `/organizations/${orgSlug}/teams/${teamSlug}/repositories`,
      {},
      token,
    ),

  setTeamRepositoryAccess: (
    token: string,
    orgSlug: string,
    teamSlug: string,
    payload: { repo_slug: string; role: 'admin' | 'write' | 'read' },
  ) =>
    request<TeamRepositoryAccess>(
      `/organizations/${orgSlug}/teams/${teamSlug}/repositories`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  removeTeamRepositoryAccess: async (
    token: string,
    orgSlug: string,
    teamSlug: string,
    repoSlug: string,
  ) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(
      `${API_BASE}/organizations/${orgSlug}/teams/${teamSlug}/repositories/${repoSlug}`,
      { method: 'DELETE', headers },
    )
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Request failed'
      throw new Error(message)
    }
  },

  listRepositoryTeamAccess: (token: string, orgSlug: string, repoSlug: string) =>
    request<RepositoryTeamAccess[]>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/team-access`,
      {},
      token,
    ),

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

  listBranchProtectionRules: (token: string, orgSlug: string, repoSlug: string) =>
    request<BranchProtectionRule[]>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/branch-protection`,
      {},
      token,
    ),

  createBranchProtectionRule: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: {
      branch_pattern: string
      require_pull_request?: boolean
      required_approvals?: number
      require_status_checks?: boolean
      allow_force_push?: boolean
      allow_admin_bypass?: boolean
    },
  ) =>
    request<BranchProtectionRule>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/branch-protection`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  updateBranchProtectionRule: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    ruleId: string,
    payload: {
      branch_pattern?: string
      require_pull_request?: boolean
      required_approvals?: number
      require_status_checks?: boolean
      allow_force_push?: boolean
      allow_admin_bypass?: boolean
    },
  ) =>
    request<BranchProtectionRule>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/branch-protection/${ruleId}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token,
    ),

  removeBranchProtectionRule: async (
    token: string,
    orgSlug: string,
    repoSlug: string,
    ruleId: string,
  ) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(
      `${API_BASE}/organizations/${orgSlug}/repositories/${repoSlug}/branch-protection/${ruleId}`,
      { method: 'DELETE', headers },
    )
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Request failed'
      throw new Error(message)
    }
  },

  listDeployKeys: (token: string, orgSlug: string, repoSlug: string) =>
    request<RepositoryDeployKey[]>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/deploy-keys`,
      {},
      token,
    ),

  createDeployKey: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: { title: string; public_key: string; read_only?: boolean },
  ) =>
    request<RepositoryDeployKey>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/deploy-keys`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  deleteDeployKey: async (token: string, orgSlug: string, repoSlug: string, keyId: string) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(
      `${API_BASE}/organizations/${orgSlug}/repositories/${repoSlug}/deploy-keys/${keyId}`,
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

  updateOrganization: (
    token: string,
    orgSlug: string,
    payload: { name?: string; slug?: string; description?: string },
  ) =>
    request<Organization>(`/organizations/${orgSlug}`, {
      method: 'PATCH',
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

  commitRepoContents: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: {
      branch: string
      message: string
      changes: Array<{ path: string; content: string | null }>
    },
  ) =>
    request<{ commit_sha: string; short_sha: string }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/contents`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

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

  listWikiPages: (orgSlug: string, repoSlug: string, token?: string | null) =>
    request<{ pages: WikiPageSummary[] }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/wiki/pages`,
      {},
      token,
    ),

  getWikiPage: (orgSlug: string, repoSlug: string, pageSlug: string, token?: string | null) =>
    request<WikiPageDetail>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/wiki/pages/${encodeURIComponent(pageSlug)}`,
      {},
      token,
    ),

  createWikiPage: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: { title: string; slug?: string; body?: string; parent_slug?: string | null; position?: number },
  ) =>
    request<WikiPageDetail>(`/organizations/${orgSlug}/repositories/${repoSlug}/wiki/pages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  updateWikiPage: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    pageSlug: string,
    payload: { title?: string; body?: string; parent_slug?: string | null; position?: number },
  ) =>
    request<WikiPageDetail>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/wiki/pages/${encodeURIComponent(pageSlug)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token,
    ),

  deleteWikiPage: (token: string, orgSlug: string, repoSlug: string, pageSlug: string) =>
    request<void>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/wiki/pages/${encodeURIComponent(pageSlug)}`,
      { method: 'DELETE' },
      token,
    ),

  listWikiRevisions: (orgSlug: string, repoSlug: string, pageSlug: string, token?: string | null) =>
    request<{ revisions: WikiRevisionSummary[] }>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/wiki/pages/${encodeURIComponent(pageSlug)}/revisions`,
      {},
      token,
    ),

  getWikiRevision: (
    orgSlug: string,
    repoSlug: string,
    pageSlug: string,
    revisionId: string,
    token?: string | null,
  ) =>
    request<WikiRevisionDetail>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/wiki/pages/${encodeURIComponent(pageSlug)}/revisions/${revisionId}`,
      {},
      token,
    ),

  searchCode: (query: string, token?: string | null, limit = 20) => {
    const search = new URLSearchParams({ q: query, limit: String(limit) })
    return request<CodeSearchResponse>(`/search/code?${search}`, {}, token)
  },

  searchRepoCode: (
    orgSlug: string,
    repoSlug: string,
    query: string,
    token?: string | null,
    limit = 20,
  ) => {
    const search = new URLSearchParams({ q: query, limit: String(limit) })
    return request<CodeSearchResponse>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/search/code?${search}`,
      {},
      token,
    )
  },

  getRepoSearchStatus: (orgSlug: string, repoSlug: string, token?: string | null) =>
    request<CodeSearchStatus>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/search/status`,
      {},
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

  updatePullRequest: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    pullNumber: number,
    payload: {
      title?: string
      body?: string
      state?: 'open' | 'closed'
    },
  ) =>
    request<PullRequestDetail>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pulls/${pullNumber}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token,
    ),

  mergePullRequest: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    pullNumber: number,
    payload?: { merge_strategy?: 'merge' | 'squash' | 'rebase' },
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

  downloadPipelineArtifact: async (
    token: string,
    orgSlug: string,
    repoSlug: string,
    runId: string,
    artifactId: string,
    filename: string,
  ) => {
    const response = await fetch(
      `${API_BASE}/organizations/${orgSlug}/repositories/${repoSlug}/pipelines/${runId}/artifacts/${artifactId}/download`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!response.ok) {
      const text = await response.text()
      throw new Error(text || `Download failed (${response.status})`)
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  },

  getPipelineConfig: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    ref?: string,
    refKind?: 'branch' | 'tag',
  ) => {
    const search = new URLSearchParams()
    if (ref) search.set('ref', ref)
    if (refKind) search.set('ref_kind', refKind)
    const qs = search.toString()
    return request<PipelineConfigPreview>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pipelines/config${qs ? `?${qs}` : ''}`,
      {},
      token,
    )
  },

  getPipelineMigrate: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    ref?: string,
  ) =>
    request<PipelineMigrateResponse>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pipelines/migrate${
        ref ? `?ref=${encodeURIComponent(ref)}` : ''
      }`,
      {},
      token,
    ),

  triggerPipeline: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: {
      commit_sha: string
      ref_name: string
      event_type?: string
      environment?: string
    },
  ) =>
    request<PipelineRun>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pipelines/trigger`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  rerunPipeline: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    runId: string,
    scope: 'all' | 'failed' = 'all',
  ) =>
    request<PipelineRun>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pipelines/${runId}/rerun`,
      {
        method: 'POST',
        body: JSON.stringify(scope === 'failed' ? { scope: 'failed' } : {}),
      },
      token,
    ),

  cancelPipeline: (token: string, orgSlug: string, repoSlug: string, runId: string) =>
    request<PipelineRun>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pipelines/${runId}/cancel`,
      { method: 'POST' },
      token,
    ),

  cancelJobStep: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    runId: string,
    jobId: string,
    stepName?: string,
  ) =>
    request<PipelineRun>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pipelines/${runId}/jobs/${jobId}/cancel-step`,
      {
        method: 'POST',
        body: JSON.stringify(stepName ? { step_name: stepName } : {}),
      },
      token,
    ),

  playManualJob: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    runId: string,
    jobId: string,
  ) =>
    request<PipelineRun>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pipelines/${runId}/jobs/${jobId}/play`,
      { method: 'POST' },
      token,
    ),

  deletePipeline: async (
    token: string,
    orgSlug: string,
    repoSlug: string,
    runId: string,
  ) => {
    await request<void>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/pipelines/${runId}`,
      { method: 'DELETE' },
      token,
    )
  },

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

  listContainerImages: (token: string, orgSlug: string) =>
    request<ContainerImageSummary[]>(`/organizations/${orgSlug}/registry/images`, {}, token),

  getContainerImage: (token: string, orgSlug: string, imageName: string) =>
    request<ContainerImageDetail>(
      `/organizations/${orgSlug}/registry/images/${encodeURIComponent(imageName)}`,
      {},
      token,
    ),

  updateContainerImage: (
    token: string,
    orgSlug: string,
    imageName: string,
    payload: { description?: string; linked_repository_id?: string | null },
  ) =>
    request<ContainerImageDetail>(
      `/organizations/${orgSlug}/registry/images/${encodeURIComponent(imageName)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token,
    ),

  deleteContainerImage: async (token: string, orgSlug: string, imageName: string) => {
    await request<void>(
      `/organizations/${orgSlug}/registry/images/${encodeURIComponent(imageName)}`,
      { method: 'DELETE' },
      token,
    )
  },

  deleteContainerTag: async (
    token: string,
    orgSlug: string,
    imageName: string,
    tagName: string,
  ) => {
    await request<void>(
      `/organizations/${orgSlug}/registry/images/${encodeURIComponent(imageName)}/tags/${encodeURIComponent(tagName)}`,
      { method: 'DELETE' },
      token,
    )
  },

  runRegistryGc: (token: string, orgSlug: string) =>
    request<RegistryGcReport>(
      `/organizations/${orgSlug}/registry/gc`,
      { method: 'POST', body: JSON.stringify({}) },
      token,
    ),

  listAuthProviders: () =>
    request<import('./types').AuthProviderPublic[]>('/auth/providers'),

  ldapLogin: (providerId: string, payload: { username: string; password: string }) =>
    request<AuthResponse>(`/auth/ldap/${providerId}/login`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listAdminAuthProviders: (token: string) =>
    request<{ provider: import('./types').AuthProviderAdmin; ldap_mappings: import('./types').LdapGroupMapping[] | null }[]>(
      '/admin/auth-providers',
      {},
      token,
    ),

  createAuthProvider: (
    token: string,
    payload: Record<string, unknown>,
  ) =>
    request<{ provider: import('./types').AuthProviderAdmin; ldap_mappings: null }>(
      '/admin/auth-providers',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  updateAuthProvider: (
    token: string,
    providerId: string,
    payload: Record<string, unknown>,
  ) =>
    request<{ provider: import('./types').AuthProviderAdmin; ldap_mappings: import('./types').LdapGroupMapping[] | null }>(
      `/admin/auth-providers/${providerId}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token,
    ),

  deleteAuthProvider: async (token: string, providerId: string) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${API_BASE}/admin/auth-providers/${providerId}`, {
      method: 'DELETE',
      headers,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(typeof body.error === 'string' ? body.error : 'Request failed')
    }
  },

  createLdapGroupMapping: (
    token: string,
    providerId: string,
    payload: { ldap_group_dn: string; organization_id: string; org_role?: string },
  ) =>
    request<import('./types').LdapGroupMapping>(
      `/admin/auth-providers/${providerId}/ldap-mappings`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  deleteLdapGroupMapping: async (token: string, providerId: string, mappingId: string) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(
      `${API_BASE}/admin/auth-providers/${providerId}/ldap-mappings/${mappingId}`,
      { method: 'DELETE', headers },
    )
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(typeof body.error === 'string' ? body.error : 'Request failed')
    }
  },

  listAuditEvents: (
    token: string,
    orgSlug: string,
    params?: {
      event_type?: string
      from?: string
      to?: string
      limit?: number
      offset?: number
    },
  ) => {
    const search = new URLSearchParams()
    if (params?.event_type) search.set('event_type', params.event_type)
    if (params?.from) search.set('from', params.from)
    if (params?.to) search.set('to', params.to)
    if (params?.limit) search.set('limit', String(params.limit))
    if (params?.offset) search.set('offset', String(params.offset))
    const qs = search.toString()
    return request<import('./types').AuditListResponse>(
      `/organizations/${orgSlug}/audit-events${qs ? `?${qs}` : ''}`,
      {},
      token,
    )
  },

  exportAuditEvents: async (
    token: string,
    orgSlug: string,
    params?: { event_type?: string; from?: string; to?: string },
  ) => {
    const search = new URLSearchParams()
    if (params?.event_type) search.set('event_type', params.event_type)
    if (params?.from) search.set('from', params.from)
    if (params?.to) search.set('to', params.to)
    const qs = search.toString()
    const headers = new Headers()
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(
      `${API_BASE}/organizations/${orgSlug}/audit-events/export${qs ? `?${qs}` : ''}`,
      { headers },
    )
    if (!response.ok) throw new Error('Export failed')
    return response.text()
  },

  listOrgSecrets: (token: string, orgSlug: string) =>
    request<import('./types').CiSecret[]>(`/organizations/${orgSlug}/secrets`, {}, token),

  createOrgSecret: (
    token: string,
    orgSlug: string,
    payload: {
      name: string
      secret_kind: import('./types').CiSecretKind
      environment?: import('./types').CiSecretEnvironment
      value: string
    },
  ) =>
    request<import('./types').CiSecret>(`/organizations/${orgSlug}/secrets`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  updateOrgSecret: (
    token: string,
    orgSlug: string,
    secretId: string,
    payload: {
      secret_kind?: import('./types').CiSecretKind
      environment?: import('./types').CiSecretEnvironment
      value?: string
    },
  ) =>
    request<import('./types').CiSecret>(`/organizations/${orgSlug}/secrets/${secretId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

  deleteOrgSecret: async (token: string, orgSlug: string, secretId: string) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${API_BASE}/organizations/${orgSlug}/secrets/${secretId}`, {
      method: 'DELETE',
      headers,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Request failed'
      throw new Error(message)
    }
  },

  listRepoSecrets: (token: string, orgSlug: string, repoSlug: string) =>
    request<import('./types').CiSecret[]>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/secrets`,
      {},
      token,
    ),

  createRepoSecret: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: {
      name: string
      secret_kind: import('./types').CiSecretKind
      environment?: import('./types').CiSecretEnvironment
      value: string
    },
  ) =>
    request<import('./types').CiSecret>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/secrets`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
    ),

  updateRepoSecret: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    secretId: string,
    payload: {
      secret_kind?: import('./types').CiSecretKind
      environment?: import('./types').CiSecretEnvironment
      value?: string
    },
  ) =>
    request<import('./types').CiSecret>(
      `/organizations/${orgSlug}/repositories/${repoSlug}/secrets/${secretId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      token,
    ),

  deleteRepoSecret: async (
    token: string,
    orgSlug: string,
    repoSlug: string,
    secretId: string,
  ) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(
      `${API_BASE}/organizations/${orgSlug}/repositories/${repoSlug}/secrets/${secretId}`,
      { method: 'DELETE', headers },
    )
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Request failed'
      throw new Error(message)
    }
  },

  getAdminSystemInfo: (token: string) =>
    request<AdminSystemInfo>('/admin/system', {}, token),

  getAdminHealth: (token: string) => request<AdminHealth>('/admin/health', {}, token),

  getAdminConfiguration: (token: string) =>
    request<AdminConfiguration>('/admin/configuration', {}, token),

  listAdminUsers: (token: string, approvalStatus?: AdminUser['approval_status']) => {
    const query = approvalStatus
      ? `?approval_status=${encodeURIComponent(approvalStatus)}`
      : ''
    return request<AdminUser[]>(`/admin/users${query}`, {}, token)
  },

  createAdminUser: (
    token: string,
    payload: {
      username: string
      email: string
      password: string
      display_name?: string
      is_super_admin?: boolean
    },
  ) =>
    request<AdminUser>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  updateAdminUser: (
    token: string,
    userId: string,
    payload: {
      username?: string
      email?: string
      password?: string
      display_name?: string
      is_super_admin?: boolean
    },
  ) =>
    request<AdminUser>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

  deleteAdminUser: async (token: string, userId: string) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${API_BASE}/admin/users/${userId}`, {
      method: 'DELETE',
      headers,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Request failed'
      throw new Error(message)
    }
  },

  approveAdminUser: (token: string, userId: string) =>
    request<AdminUser>(`/admin/users/${userId}/approve`, { method: 'POST' }, token),

  rejectAdminUser: (token: string, userId: string) =>
    request<AdminUser>(`/admin/users/${userId}/reject`, { method: 'POST' }, token),

  getBackupOverview: (token: string) =>
    request<BackupOverview>('/admin/backups/overview', {}, token),

  listBackups: (token: string) => request<BackupJob[]>('/admin/backups', {}, token),

  createBackup: (token: string, components: BackupComponentId[]) =>
    request<BackupJob>(
      '/admin/backups',
      { method: 'POST', body: JSON.stringify({ components }) },
      token,
    ),

  getBackup: (token: string, backupId: string) =>
    request<BackupJob>(`/admin/backups/${backupId}`, {}, token),

  deleteBackup: async (token: string, backupId: string) => {
    const headers = new Headers()
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${API_BASE}/admin/backups/${backupId}`, {
      method: 'DELETE',
      headers,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Request failed'
      throw new Error(message)
    }
  },

  downloadBackup: async (token: string, backupId: string) => {
    const headers = new Headers()
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${API_BASE}/admin/backups/${backupId}/download`, { headers })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const message = typeof body.error === 'string' ? body.error : 'Download failed'
      throw new Error(message)
    }
    return response.blob()
  },

  restoreBackup: async (
    token: string,
    archive: File,
    components: BackupComponentId[],
    confirm: string,
  ) => {
    const form = new FormData()
    form.append('archive', archive)
    form.append('components', JSON.stringify(components))
    form.append('confirm', confirm)
    const headers = new Headers()
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${API_BASE}/admin/backups/restore`, {
      method: 'POST',
      headers,
      body: form,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = typeof body.error === 'string' ? body.error : 'Restore failed'
      throw new Error(message)
    }
    return body as BackupJob
  },

  listImportCredentials: (token: string, orgSlug: string) =>
    request<ImportCredential[]>(`/organizations/${orgSlug}/import/credentials`, {}, token),

  saveImportCredential: (
    token: string,
    orgSlug: string,
    payload: {
      provider: 'github' | 'gitlab'
      token: string
      base_url?: string
      label?: string
    },
  ) =>
    request<ImportCredential>(`/organizations/${orgSlug}/import/credentials`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  deleteImportCredential: async (token: string, orgSlug: string, credentialId: string) => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(
      `${API_BASE}/organizations/${orgSlug}/import/credentials/${credentialId}`,
      { method: 'DELETE', headers },
    )
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(typeof body.error === 'string' ? body.error : 'Request failed')
    }
  },

  discoverImportRepos: (
    token: string,
    orgSlug: string,
    payload: {
      credential_id?: string
      provider?: 'github' | 'gitlab'
      token?: string
      base_url?: string
      namespace?: string
      namespace_kind?: 'personal' | 'organization' | 'group'
    },
  ) =>
    request<{ account: string; namespaces: RemoteNamespace[]; repos: RemoteRepo[] }>(
      `/organizations/${orgSlug}/import/discover`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  createImportJob: (
    token: string,
    orgSlug: string,
    payload: {
      credential_id: string
      import_issues?: boolean
      import_pull_requests?: boolean
      repos: Array<{
        source_id: string
        source_full_name: string
        source_clone_url: string
        target_slug?: string
        target_name?: string
        description?: string
        visibility?: 'public' | 'private'
        default_branch?: string
      }>
    },
  ) =>
    request<ImportJobDetail>(`/organizations/${orgSlug}/import/jobs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  listImportJobs: (token: string, orgSlug: string) =>
    request<ImportJob[]>(`/organizations/${orgSlug}/import/jobs`, {}, token),

  getImportJob: (token: string, orgSlug: string, jobId: string) =>
    request<ImportJobDetail>(`/organizations/${orgSlug}/import/jobs/${jobId}`, {}, token),
}
