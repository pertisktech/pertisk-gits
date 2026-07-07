import type {
  AdminConfiguration,
  ObservabilitySettings,
  UpdateObservabilitySettingsPayload,
  SmtpSettings,
  UpdateSmtpSettingsPayload,
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
  DashboardProjectStats,
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
  ImportOnConflict,
  ImportProvider,
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
  TagInfo,
  BranchInfo,
  TreeEntry,
  BlameLine,
  User,
  MeResponse,
  UpdateProfilePayload,
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
import { handleUnauthorizedResponse } from '../auth/session'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

function triggerBrowserDownload(url: string, filename?: string) {
  const link = document.createElement('a')
  link.href = url
  if (filename) link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function downloadUrl(path: string, token: string) {
  const params = new URLSearchParams({ access_token: token })
  return `${API_BASE}${path}?${params}`
}

/** Nested group path as one URL segment (`a/b` → `a%2Fb`) for Axum `{org_path}` routes. */
export function orgApiPath(path: string): string {
  return encodeURIComponent(path.replace(/^\/+|\/+$/g, ''))
}

async function authFetch(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<Response> {
  const hadAuthToken = Boolean(token)
  const headers = new Headers(options.headers)
  if (
    !headers.has('Content-Type')
    && options.body != null
    && !(options.body instanceof FormData)
  ) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (!response.ok) {
    handleUnauthorizedResponse(response.status, hadAuthToken)
  }
  return response
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const response = await authFetch(path, options, token)
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
    request<MeResponse>('/me', {}, token),

  updateProfile: (token: string, payload: UpdateProfilePayload) =>
    request<MeResponse>('/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

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

  deleteSshKey: (token: string, keyId: string) =>
    request<void>(`/me/ssh-keys/${keyId}`, { method: 'DELETE' }, token),

  listApiTokens: (token: string) => request<ApiTokenSummary[]>('/me/tokens', {}, token),

  createApiToken: (token: string, payload: { name: string; scopes?: string[] }) =>
    request<{ token: ApiTokenSummary; plaintext: string }>(
      '/me/tokens',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  deleteApiToken: (token: string, tokenId: string) =>
    request<void>(`/me/tokens/${tokenId}`, { method: 'DELETE' }, token),

  listMachineUsers: (token: string, orgSlug: string) =>
    request<MachineUserSummary[]>(`/organizations/${orgApiPath(orgSlug)}/machine-users`, {}, token),

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
      `/organizations/${orgApiPath(orgSlug)}/machine-users`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  listRepoGitOpsWebhooks: (token: string, orgSlug: string, repoSlug: string) =>
    request<GitOpsWebhookSummary[]>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/gitops-webhooks`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/gitops-webhooks`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  deleteRepoGitOpsWebhook: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    webhookId: string,
  ) =>
    request<void>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/gitops-webhooks/${webhookId}`,
      { method: 'DELETE' },
      token,
    ),

  listOrganizations: (token: string) =>
    request<Organization[]>('/organizations', {}, token),

  getDashboardProjectStats: (
    token: string,
    projects: { org_path: string; slug: string }[],
  ) =>
    request<{ stats: DashboardProjectStats[] }>(
      '/dashboard/project-stats',
      { method: 'POST', body: JSON.stringify({ projects }) },
      token,
    ),

  listSubgroups: (token: string, orgPath: string) =>
    request<Organization[]>(`/organizations/${orgApiPath(orgPath)}/subgroups`, {}, token),

  listOrganizationMembers: (token: string, orgSlug: string) =>
    request<OrgMember[]>(`/organizations/${orgApiPath(orgSlug)}/members`, {}, token),

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
    request<OrgMember>(`/organizations/${orgApiPath(orgSlug)}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  updateOrganizationMember: (
    token: string,
    orgSlug: string,
    userId: string,
    payload: { role: 'owner' | 'admin' | 'member'; custom_role_id?: string | null },
  ) =>
    request<OrgMember>(`/organizations/${orgApiPath(orgSlug)}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

  removeOrganizationMember: (token: string, orgSlug: string, userId: string) =>
    request<void>(`/organizations/${orgApiPath(orgSlug)}/members/${userId}`, { method: 'DELETE' }, token),

  listCustomRoles: (token: string, orgSlug: string) =>
    request<OrganizationCustomRole[]>(`/organizations/${orgApiPath(orgSlug)}/custom-roles`, {}, token),

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
    request<OrganizationCustomRole>(`/organizations/${orgApiPath(orgSlug)}/custom-roles`, {
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
    request<OrganizationCustomRole>(`/organizations/${orgApiPath(orgSlug)}/custom-roles/${roleSlug}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

  deleteCustomRole: (token: string, orgSlug: string, roleSlug: string) =>
    request<void>(`/organizations/${orgApiPath(orgSlug)}/custom-roles/${roleSlug}`, { method: 'DELETE' }, token),

  listTeams: (token: string, orgSlug: string) =>
    request<TeamSummary[]>(`/organizations/${orgApiPath(orgSlug)}/teams`, {}, token),

  createTeam: (
    token: string,
    orgSlug: string,
    payload: { name: string; slug?: string; description?: string },
  ) =>
    request<TeamDetail>(`/organizations/${orgApiPath(orgSlug)}/teams`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  getTeam: (token: string, orgSlug: string, teamSlug: string) =>
    request<TeamDetail>(`/organizations/${orgApiPath(orgSlug)}/teams/${teamSlug}`, {}, token),

  updateTeam: (
    token: string,
    orgSlug: string,
    teamSlug: string,
    payload: { name?: string; description?: string },
  ) =>
    request<TeamDetail>(`/organizations/${orgApiPath(orgSlug)}/teams/${teamSlug}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

  deleteTeam: (token: string, orgSlug: string, teamSlug: string) =>
    request<void>(`/organizations/${orgApiPath(orgSlug)}/teams/${teamSlug}`, { method: 'DELETE' }, token),

  listTeamMembers: (token: string, orgSlug: string, teamSlug: string) =>
    request<TeamMemberEntry[]>(`/organizations/${orgApiPath(orgSlug)}/teams/${teamSlug}/members`, {}, token),

  addTeamMember: (
    token: string,
    orgSlug: string,
    teamSlug: string,
    payload: { username?: string; user_id?: string },
  ) =>
    request<TeamMemberEntry>(`/organizations/${orgApiPath(orgSlug)}/teams/${teamSlug}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  removeTeamMember: (token: string, orgSlug: string, teamSlug: string, userId: string) =>
    request<void>(
      `/organizations/${orgApiPath(orgSlug)}/teams/${teamSlug}/members/${userId}`,
      { method: 'DELETE' },
      token,
    ),

  listTeamRepositories: (token: string, orgSlug: string, teamSlug: string) =>
    request<TeamRepositoryAccess[]>(
      `/organizations/${orgApiPath(orgSlug)}/teams/${teamSlug}/repositories`,
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
      `/organizations/${orgApiPath(orgSlug)}/teams/${teamSlug}/repositories`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  removeTeamRepositoryAccess: (
    token: string,
    orgSlug: string,
    teamSlug: string,
    repoSlug: string,
  ) =>
    request<void>(
      `/organizations/${orgApiPath(orgSlug)}/teams/${teamSlug}/repositories/${repoSlug}`,
      { method: 'DELETE' },
      token,
    ),

  listRepositoryTeamAccess: (token: string, orgSlug: string, repoSlug: string) =>
    request<RepositoryTeamAccess[]>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/team-access`,
      {},
      token,
    ),

  listRepositoryCollaborators: (token: string, orgSlug: string, repoSlug: string) =>
    request<RepoCollaborator[]>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/collaborators`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/collaborators`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/collaborators/${userId}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token,
    ),

  removeRepositoryCollaborator: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    userId: string,
  ) =>
    request<void>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/collaborators/${userId}`,
      { method: 'DELETE' },
      token,
    ),

  listBranchProtectionRules: (token: string, orgSlug: string, repoSlug: string) =>
    request<BranchProtectionRule[]>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/branch-protection`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/branch-protection`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/branch-protection/${ruleId}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token,
    ),

  removeBranchProtectionRule: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    ruleId: string,
  ) =>
    request<void>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/branch-protection/${ruleId}`,
      { method: 'DELETE' },
      token,
    ),

  listDeployKeys: (token: string, orgSlug: string, repoSlug: string) =>
    request<RepositoryDeployKey[]>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/deploy-keys`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/deploy-keys`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  deleteDeployKey: (token: string, orgSlug: string, repoSlug: string, keyId: string) =>
    request<void>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/deploy-keys/${keyId}`,
      { method: 'DELETE' },
      token,
    ),

  createOrganization: (
    token: string,
    payload: { name: string; slug: string; description?: string; parent_path?: string },
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
    request<Organization>(`/organizations/${orgApiPath(orgSlug)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

  listRepositories: (
    token: string,
    orgSlug: string,
    options?: { recursive?: boolean },
  ) => {
    const search = new URLSearchParams()
    if (options?.recursive) search.set('recursive', 'true')
    const qs = search.toString()
    return request<Repository[]>(
      `/organizations/${orgApiPath(orgSlug)}/repositories${qs ? `?${qs}` : ''}`,
      {},
      token,
    )
  },

  createRepository: (
    token: string,
    orgSlug: string,
    payload: { name: string; slug: string; description?: string; visibility?: 'public' | 'private' },
  ) =>
    request<Repository>(`/organizations/${orgApiPath(orgSlug)}/repositories`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  getRepository: (orgSlug: string, repoSlug: string, token?: string | null) =>
    request<RepositoryDetail>(`/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}`, {}, token),

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
    request<RepositoryDetail>(`/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

  deleteRepository: (token: string, orgSlug: string, repoSlug: string) =>
    request<void>(`/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}`, {
      method: 'DELETE',
    }, token),

  transferRepository: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    targetOrgPath: string,
  ) =>
    request<RepositoryDetail>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/transfer`,
      {
        method: 'POST',
        body: JSON.stringify({ target_org_path: targetOrgPath }),
      },
      token,
    ),

  deleteOrganization: (token: string, orgSlug: string, cascade = false) =>
    request<void>(
      `/organizations/${orgApiPath(orgSlug)}${cascade ? '?cascade=true' : ''}`,
      { method: 'DELETE' },
      token,
    ),

  getRepoBrowser: (orgSlug: string, repoSlug: string, token?: string | null) =>
    request<{ browser: RepoBrowser }>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/browser`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/tree?${search}`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/blob?${search}`,
      {},
      token,
    )
  },

  getRepoBlame: (
    orgSlug: string,
    repoSlug: string,
    params: { ref: string; path: string; ref_kind?: 'branch' | 'tag' },
    token?: string | null,
  ) => {
    const search = new URLSearchParams({ ref: params.ref, path: params.path })
    if (params.ref_kind) search.set('ref_kind', params.ref_kind)
    return request<{ path: string; ref: string; lines: BlameLine[] }>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/blame?${search}`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/contents`,
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
    return `${API_BASE}/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/raw?${search}`
  },

  repoArchiveUrl: (
    orgSlug: string,
    repoSlug: string,
    params: { ref: string; ref_kind?: 'branch' | 'tag' },
  ) => {
    const search = new URLSearchParams({ ref: params.ref })
    if (params.ref_kind) search.set('ref_kind', params.ref_kind)
    return `${API_BASE}/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/archive?${search}`
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/commits?${search}`,
      {},
      token,
    )
  },

  getRepoTags: (orgSlug: string, repoSlug: string, token?: string | null) =>
    request<{ tags: TagInfo[] }>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/tags`,
      {},
      token,
    ),

  createRepoTag: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: { name: string; target_ref?: string; message?: string },
  ) =>
    request<{ tag: TagInfo }>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/tags`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  updateRepoTag: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    tagName: string,
    payload: { name?: string; target_ref?: string; message?: string },
  ) =>
    request<{ tag: TagInfo }>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/tags/${encodeURIComponent(tagName)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token,
    ),

  deleteRepoTag: (token: string, orgSlug: string, repoSlug: string, tagName: string) =>
    request<void>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/tags/${encodeURIComponent(tagName)}`,
      { method: 'DELETE' },
      token,
    ),

  getRepoBranches: (orgSlug: string, repoSlug: string, token?: string | null) =>
    request<{ branches: BranchInfo[] }>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/branches`,
      {},
      token,
    ),

  createRepoBranch: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: { name: string; source_ref?: string },
  ) =>
    request<{ branch: BranchInfo }>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/branches`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  deleteRepoBranch: (token: string, orgSlug: string, repoSlug: string, branchName: string) =>
    request<void>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/branches/${encodeURIComponent(branchName)}`,
      { method: 'DELETE' },
      token,
    ),

  getRepoCommit: (orgSlug: string, repoSlug: string, commitSha: string, token?: string | null) =>
    request<{ commit: CommitDetail }>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/commits/${commitSha}`,
      {},
      token,
    ),

  listLabels: (orgSlug: string, repoSlug: string, token?: string | null) =>
    request<Label[]>(`/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/labels`, {}, token),

  createLabel: (token: string, orgSlug: string, repoSlug: string, payload: { name: string; color?: string; description?: string }) =>
    request<Label>(`/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/labels`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  listMilestones: (orgSlug: string, repoSlug: string, token?: string | null) =>
    request<Milestone[]>(`/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/milestones`, {}, token),

  createMilestone: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: { title: string; description?: string; due_on?: string },
  ) =>
    request<Milestone>(`/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/milestones`, {
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/issues${qs ? `?${qs}` : ''}`,
      {},
      token,
    )
  },

  getIssue: (orgSlug: string, repoSlug: string, issueNumber: number, token?: string | null) =>
    request<IssueDetail>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/issues/${issueNumber}`,
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
    request<IssueDetail>(`/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/issues`, {
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
    request<IssueDetail>(`/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/issues/${issueNumber}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

  listIssueComments: (orgSlug: string, repoSlug: string, issueNumber: number, token?: string | null) =>
    request<IssueCommentDetail[]>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/issues/${issueNumber}/comments`,
      {},
      token,
    ),

  createIssueComment: (token: string, orgSlug: string, repoSlug: string, issueNumber: number, body: string) =>
    request<IssueCommentDetail>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/issues/${issueNumber}/comments`,
      { method: 'POST', body: JSON.stringify({ body }) },
      token,
    ),

  listWikiPages: (orgSlug: string, repoSlug: string, token?: string | null) =>
    request<{ pages: WikiPageSummary[] }>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/wiki/pages`,
      {},
      token,
    ),

  getWikiPage: (orgSlug: string, repoSlug: string, pageSlug: string, token?: string | null) =>
    request<WikiPageDetail>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/wiki/pages/${encodeURIComponent(pageSlug)}`,
      {},
      token,
    ),

  createWikiPage: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: { title: string; slug?: string; body?: string; parent_slug?: string | null; position?: number },
  ) =>
    request<WikiPageDetail>(`/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/wiki/pages`, {
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/wiki/pages/${encodeURIComponent(pageSlug)}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token,
    ),

  deleteWikiPage: (token: string, orgSlug: string, repoSlug: string, pageSlug: string) =>
    request<void>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/wiki/pages/${encodeURIComponent(pageSlug)}`,
      { method: 'DELETE' },
      token,
    ),

  listWikiRevisions: (orgSlug: string, repoSlug: string, pageSlug: string, token?: string | null) =>
    request<{ revisions: WikiRevisionSummary[] }>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/wiki/pages/${encodeURIComponent(pageSlug)}/revisions`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/wiki/pages/${encodeURIComponent(pageSlug)}/revisions/${revisionId}`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/search/code?${search}`,
      {},
      token,
    )
  },

  getRepoSearchStatus: (orgSlug: string, repoSlug: string, token?: string | null) =>
    request<CodeSearchStatus>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/search/status`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pulls${qs ? `?${qs}` : ''}`,
      {},
      token,
    )
  },

  getPullRequest: (orgSlug: string, repoSlug: string, pullNumber: number, token?: string | null) =>
    request<PullRequestDetail>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pulls/${pullNumber}`,
      {},
      token,
    ),

  createPullRequest: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: { title: string; body?: string; source_branch: string; target_branch: string },
  ) =>
    request<PullRequestDetail>(`/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pulls`, {
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pulls/${pullNumber}`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pulls/${pullNumber}/merge`,
      { method: 'POST', body: JSON.stringify(payload ?? {}) },
      token,
    ),

  listPullRequestComments: (orgSlug: string, repoSlug: string, pullNumber: number, token?: string | null) =>
    request<PullRequestCommentDetail[]>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pulls/${pullNumber}/comments`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pulls/${pullNumber}/comments`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  listPullRequestReviews: (orgSlug: string, repoSlug: string, pullNumber: number, token?: string | null) =>
    request<PullRequestReviewDetail[]>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pulls/${pullNumber}/reviews`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pulls/${pullNumber}/reviews`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  listPipelineRuns: (token: string, orgSlug: string, repoSlug: string) =>
    request<PipelineRun[]>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pipelines`,
      {},
      token,
    ),

  getPipelineRun: (token: string, orgSlug: string, repoSlug: string, runId: string) =>
    request<PipelineRun>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pipelines/${runId}`,
      {},
      token,
    ),

  downloadPipelineArtifact: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    runId: string,
    artifactId: string,
    filename: string,
  ) => {
    const url = downloadUrl(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pipelines/${runId}/artifacts/${artifactId}/download`,
      token,
    )
    triggerBrowserDownload(url, filename)
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pipelines/config${qs ? `?${qs}` : ''}`,
      {},
      token,
    )
  },

  getPipelineMigrate: (
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
    return request<PipelineMigrateResponse>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pipelines/migrate${qs ? `?${qs}` : ''}`,
      {},
      token,
    )
  },

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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pipelines/trigger`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pipelines/${runId}/rerun`,
      {
        method: 'POST',
        body: JSON.stringify(scope === 'failed' ? { scope: 'failed' } : {}),
      },
      token,
    ),

  cancelPipeline: (token: string, orgSlug: string, repoSlug: string, runId: string) =>
    request<PipelineRun>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pipelines/${runId}/cancel`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pipelines/${runId}/jobs/${jobId}/cancel-step`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pipelines/${runId}/jobs/${jobId}/play`,
      { method: 'POST' },
      token,
    ),

  rerunJob: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    runId: string,
    jobId: string,
  ) =>
    request<PipelineRun>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pipelines/${runId}/jobs/${jobId}/rerun`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/pipelines/${runId}`,
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
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/commits/${commitSha}/statuses`,
      {},
      token,
    ),

  listRunners: (token: string) => request<Runner[]>('/runners', {}, token),

  registerRunner: (token: string, payload: { name: string; labels?: string[] }) =>
    request<RegisterRunnerResponse>('/runners/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  deleteRunner: (token: string, runnerId: string) =>
    request<void>(`/runners/${runnerId}`, { method: 'DELETE' }, token),

  rotateRunnerToken: (token: string, runnerId: string) =>
    request<RotateRunnerTokenResponse>(`/runners/${runnerId}/rotate-token`, {
      method: 'POST',
      body: JSON.stringify({}),
    }, token),

  listContainerImages: (token: string, orgSlug: string, repoSlug: string, provider?: string) => {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : ''
    return request<ContainerImageSummary[]>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/registry/images${query}`,
      {},
      token,
    )
  },

  getContainerImage: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    imageName: string,
    provider?: string,
  ) =>
    request<ContainerImageDetail>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/registry/images/${encodeURIComponent(imageName)}${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`,
      {},
      token,
    ),

  updateContainerImage: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    imageName: string,
    payload: { description?: string },
    provider?: string,
  ) =>
    request<ContainerImageDetail>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/registry/images/${encodeURIComponent(imageName)}${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token,
    ),

  deleteContainerImage: async (
    token: string,
    orgSlug: string,
    repoSlug: string,
    imageName: string,
    provider?: string,
  ) => {
    await request<void>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/registry/images/${encodeURIComponent(imageName)}${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`,
      { method: 'DELETE' },
      token,
    )
  },

  deleteContainerTag: async (
    token: string,
    orgSlug: string,
    repoSlug: string,
    imageName: string,
    tagName: string,
    provider?: string,
  ) => {
    await request<void>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/registry/images/${encodeURIComponent(imageName)}/tags/${encodeURIComponent(tagName)}${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`,
      { method: 'DELETE' },
      token,
    )
  },

  runRegistryGc: (token: string, orgSlug: string, repoSlug: string) =>
    request<RegistryGcReport>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/registry/gc`,
      { method: 'POST', body: JSON.stringify({}) },
      token,
    ),

  listAuthProviders: () =>
    request<import('./types').AuthProviderPublic[]>('/auth/providers'),

  completeOidcSession: (providerId: string, payload: { id_token: string; access_token?: string }) =>
    request<AuthResponse>(`/auth/oidc/${providerId}/session`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  ldapLogin: (providerId: string, payload: { username: string; password: string }) =>
    request<AuthResponse>(`/auth/ldap/${providerId}/login`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listAdminAuthProviders: (token: string) =>
    request<import('./types').AuthProviderAdmin[]>('/admin/auth-providers', {}, token),

  createAuthProvider: (
    token: string,
    payload: Record<string, unknown>,
  ) =>
    request<import('./types').AuthProviderAdmin>(
      '/admin/auth-providers',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  updateAuthProvider: (
    token: string,
    providerId: string,
    payload: Record<string, unknown>,
  ) =>
    request<import('./types').AuthProviderAdmin>(
      `/admin/auth-providers/${providerId}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token,
    ),

  deleteAuthProvider: (token: string, providerId: string) =>
    request<void>(`/admin/auth-providers/${providerId}`, { method: 'DELETE' }, token),

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

  deleteLdapGroupMapping: (token: string, providerId: string, mappingId: string) =>
    request<void>(
      `/admin/auth-providers/${providerId}/ldap-mappings/${mappingId}`,
      { method: 'DELETE' },
      token,
    ),

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
      `/organizations/${orgApiPath(orgSlug)}/audit-events${qs ? `?${qs}` : ''}`,
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
    const response = await authFetch(
      `/organizations/${orgApiPath(orgSlug)}/audit-events/export${qs ? `?${qs}` : ''}`,
      {},
      token,
    )
    if (!response.ok) throw new Error('Export failed')
    return response.text()
  },

  listOrgSecrets: (token: string, orgSlug: string) =>
    request<import('./types').CiSecret[]>(`/organizations/${orgApiPath(orgSlug)}/secrets`, {}, token),

  createOrgSecret: (
    token: string,
    orgSlug: string,
    payload: {
      name: string
      secret_kind?: import('./types').CiSecretKind
      config_scope?: import('./types').CiConfigScope
      masked?: boolean
      environment?: import('./types').CiSecretEnvironment
      value: string
    },
  ) =>
    request<import('./types').CiSecret>(`/organizations/${orgApiPath(orgSlug)}/secrets`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  updateOrgSecret: (
    token: string,
    orgSlug: string,
    secretId: string,
    payload: {
      secret_kind?: import('./types').CiSecretKind
      config_scope?: import('./types').CiConfigScope
      masked?: boolean
      environment?: import('./types').CiSecretEnvironment
      value?: string
    },
  ) =>
    request<import('./types').CiSecret>(`/organizations/${orgApiPath(orgSlug)}/secrets/${secretId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, token),

  deleteOrgSecret: (token: string, orgSlug: string, secretId: string) =>
    request<void>(`/organizations/${orgApiPath(orgSlug)}/secrets/${secretId}`, { method: 'DELETE' }, token),

  listRepoSecrets: (token: string, orgSlug: string, repoSlug: string) =>
    request<import('./types').CiSecret[]>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/secrets`,
      {},
      token,
    ),

  createRepoSecret: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    payload: {
      name: string
      secret_kind?: import('./types').CiSecretKind
      config_scope?: import('./types').CiConfigScope
      masked?: boolean
      environment?: import('./types').CiSecretEnvironment
      value: string
    },
  ) =>
    request<import('./types').CiSecret>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/secrets`,
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
      config_scope?: import('./types').CiConfigScope
      masked?: boolean
      environment?: import('./types').CiSecretEnvironment
      value?: string
    },
  ) =>
    request<import('./types').CiSecret>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/secrets/${secretId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      token,
    ),

  deleteRepoSecret: (
    token: string,
    orgSlug: string,
    repoSlug: string,
    secretId: string,
  ) =>
    request<void>(
      `/organizations/${orgApiPath(orgSlug)}/repositories/${repoSlug}/secrets/${secretId}`,
      { method: 'DELETE' },
      token,
    ),

  getAdminSystemInfo: (token: string) =>
    request<AdminSystemInfo>('/admin/system', {}, token),

  getAdminHealth: (token: string) => request<AdminHealth>('/admin/health', {}, token),

  getAdminConfiguration: (token: string) =>
    request<AdminConfiguration>('/admin/configuration', {}, token),

  getObservabilitySettings: (token: string) =>
    request<ObservabilitySettings>('/admin/observability', {}, token),

  updateObservabilitySettings: (token: string, payload: UpdateObservabilitySettingsPayload) =>
    request<ObservabilitySettings>('/admin/observability', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }, token),

  getAdminMetrics: async (token: string) => {
    const response = await authFetch('/admin/metrics', {}, token)
    const body = await response.text().catch(() => '')
    if (!response.ok) {
      let message = 'Failed to load metrics'
      try {
        const json = JSON.parse(body) as { error?: string }
        if (typeof json.error === 'string') message = json.error
      } catch {
        // non-JSON error body
      }
      throw new Error(message)
    }
    return body
  },

  getSmtpSettings: (token: string) =>
    request<SmtpSettings>('/admin/notifications/smtp', {}, token),

  updateSmtpSettings: (token: string, payload: UpdateSmtpSettingsPayload) =>
    request<SmtpSettings>('/admin/notifications/smtp', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }, token),

  testSmtpSettings: (token: string, to?: string) =>
    request<{ ok: boolean; to: string }>('/admin/notifications/smtp/test', {
      method: 'POST',
      body: JSON.stringify(to ? { to } : {}),
    }, token),

  previewSmtpTemplate: async (token: string, template: string) => {
    const query = `?template=${encodeURIComponent(template)}`
    const response = await authFetch(`/admin/notifications/smtp/preview${query}`, {}, token)
    const body = await response.text().catch(() => '')
    if (!response.ok) {
      let message = 'Failed to load email preview'
      try {
        const json = JSON.parse(body) as { error?: string }
        if (typeof json.error === 'string') message = json.error
      } catch {
        // non-JSON error body
      }
      throw new Error(message)
    }
    return body
  },

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

  deleteAdminUser: (token: string, userId: string) =>
    request<void>(`/admin/users/${userId}`, { method: 'DELETE' }, token),

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

  deleteBackup: (token: string, backupId: string) =>
    request<void>(`/admin/backups/${backupId}`, { method: 'DELETE' }, token),

  downloadBackup: (token: string, backupId: string) => {
    const url = downloadUrl(`/admin/backups/${backupId}/download`, token)
    triggerBrowserDownload(url, `pertisk-backup-${backupId}.tar.gz`)
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
    const response = await authFetch('/admin/backups/restore', { method: 'POST', body: form }, token)
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = typeof body.error === 'string' ? body.error : 'Restore failed'
      throw new Error(message)
    }
    return body as BackupJob
  },

  listImportCredentials: (token: string, orgSlug: string) =>
    request<ImportCredential[]>(`/organizations/${orgApiPath(orgSlug)}/import/credentials`, {}, token),

  listMyImportCredentials: (token: string) =>
    request<ImportCredential[]>('/import/credentials', {}, token),

  saveImportCredential: (
    token: string,
    orgSlug: string,
    payload: {
      provider: ImportProvider
      token: string
      base_url?: string
      label?: string
    },
  ) =>
    request<ImportCredential>(`/organizations/${orgApiPath(orgSlug)}/import/credentials`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  deleteImportCredential: (token: string, orgSlug: string, credentialId: string) =>
    request<void>(
      `/organizations/${orgApiPath(orgSlug)}/import/credentials/${credentialId}`,
      { method: 'DELETE' },
      token,
    ),

  previewImport: (
    token: string,
    payload: {
      provider: ImportProvider
      token: string
      base_url?: string
    },
  ) =>
    request<{ account: string; namespaces: RemoteNamespace[] }>(
      '/import/preview',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  ensureImportGroup: (token: string, payload: { path: string }) =>
    request<Organization>(
      '/import/ensure-group',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  discoverImportRepos: (
    token: string,
    orgSlug: string,
    payload: {
      credential_id?: string
      provider?: ImportProvider
      token?: string
      base_url?: string
      namespace?: string
      namespace_kind?: 'personal' | 'organization' | 'group'
    },
  ) =>
    request<{ account: string; namespaces: RemoteNamespace[]; repos: RemoteRepo[]; max_repos_per_job: number }>(
      `/organizations/${orgApiPath(orgSlug)}/import/discover`,
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
      import_wiki?: boolean
      on_conflict?: ImportOnConflict
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
    request<ImportJobDetail>(`/organizations/${orgApiPath(orgSlug)}/import/jobs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token),

  listImportJobs: (token: string, orgSlug: string) =>
    request<ImportJob[]>(`/organizations/${orgApiPath(orgSlug)}/import/jobs`, {}, token),

  getImportJob: (token: string, orgSlug: string, jobId: string) =>
    request<ImportJobDetail>(`/organizations/${orgApiPath(orgSlug)}/import/jobs/${jobId}`, {}, token),
}
