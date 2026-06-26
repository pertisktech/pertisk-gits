export interface User {
  id: string
  username: string
  email: string
  display_name: string | null
  created_at: string
  is_super_admin?: boolean
}

export interface Organization {
  id: string
  slug: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface Repository {
  id: string
  organization_id: string
  name: string
  slug: string
  description: string | null
  visibility: 'public' | 'private'
  default_branch: string
  created_at: string
  updated_at: string
}

export interface RepositoryDetail {
  repository: Repository
  clone_url_http: string
  clone_url_ssh?: string | null
}

export interface UserSshKey {
  id: string
  user_id: string
  title: string
  public_key: string
  fingerprint: string
  created_at: string
}

export interface TreeEntry {
  name: string
  path: string
  kind: 'blob' | 'tree' | string
  mode: string
  size: number | null
  last_commit?: EntryLastCommit | null
}

export interface EntryLastCommit {
  sha: string
  short_sha: string
  message: string
  committed_at: number
}

export interface CommitInfo {
  sha: string
  short_sha: string
  author_name: string
  author_email: string
  committed_at: number
  message: string
}

export interface CommitDetail extends CommitInfo {
  body: string
  parents: string[]
  diff: string
  files_changed: number
  insertions: number
  deletions: number
}

export interface RepoBrowser {
  branches: string[]
  tags: string[]
  default_ref: string
  empty: boolean
}

export interface OrgMember {
  user: User
  role: 'owner' | 'admin' | 'member'
}

export interface RepoCollaborator {
  user: User
  role: 'admin' | 'write' | 'read'
}

export interface AuthResponse {
  token: string
  user: User
  is_super_admin: boolean
}

export interface AdminUser {
  id: string
  username: string
  email: string
  display_name: string | null
  is_super_admin: boolean
  has_password: boolean
  created_at: string
  updated_at: string
}

export interface AdminSystemInfo {
  version: string
  rust_version: string
  started_at: string
  counts: {
    users: number
    organizations: number
    repositories: number
    pipeline_runs: number
    runners: number
  }
  host: {
    hostname: string
    cpu_cores: number
    cpu_usage_percent: number
    memory_total_bytes: number
    memory_used_bytes: number
    disk_total_bytes: number
    disk_used_bytes: number
    disk_free_bytes: number
  }
  process: {
    pid: number
    memory_bytes: number
    cpu_usage_percent: number
  }
  storage: {
    repos_root: string
    repos_root_exists: boolean
    repos_disk_bytes: number
    artifacts_root: string
    artifacts_root_exists: boolean
    artifacts_count: number
    artifacts_db_bytes: number
    artifacts_disk_bytes: number
    registry_root: string
    registry_root_exists: boolean
    registry_blob_count: number
    registry_db_bytes: number
    registry_disk_bytes: number
  }
}

export interface AdminS3Health {
  status: string
  latency_ms: number
  endpoint: string
  bucket: string
  region: string
  error?: string | null
}

export interface AdminHealth {
  status: string
  version: string
  database: string
  database_latency_ms: number
  database_version: string
  api_url: string
  checked_at: string
  s3?: AdminS3Health | null
}

export interface AdminConfiguration {
  api_host: string
  api_port: number
  git_public_base_url: string
  git_ssh_public_host: string | null
  git_ssh_port: number | null
  repos_root: string
  artifacts_root: string
  web_dist: string | null
  registration_enabled: boolean
  super_admin_env_override: boolean
}

export interface Label {
  id: string
  repository_id: string
  name: string
  color: string
  description: string | null
  created_at: string
}

export interface Milestone {
  id: string
  repository_id: string
  title: string
  description: string | null
  due_on: string | null
  state: 'open' | 'closed'
  created_at: string
  updated_at: string
}

export interface Issue {
  id: string
  repository_id: string
  number: number
  author_id: string
  assignee_id: string | null
  milestone_id: string | null
  title: string
  body: string
  state: 'open' | 'closed'
  created_at: string
  updated_at: string
  closed_at: string | null
}

export interface IssueDetail {
  issue: Issue
  author: User
  assignee: User | null
  milestone: Milestone | null
  labels: Label[]
}

export interface IssueComment {
  id: string
  issue_id: string
  author_id: string
  body: string
  created_at: string
  updated_at: string
}

export interface IssueCommentDetail {
  comment: IssueComment
  author: User
}

export interface PullRequest {
  id: string
  repository_id: string
  number: number
  author_id: string
  title: string
  body: string
  source_branch: string
  target_branch: string
  state: 'open' | 'closed' | 'merged'
  merge_commit_sha: string | null
  created_at: string
  updated_at: string
  merged_at: string | null
  closed_at: string | null
}

export interface CompareResult {
  base: string
  head: string
  merge_base: string
  diff: string
  commits: CommitInfo[]
  files_changed: number
  insertions: number
  deletions: number
  mergeable: boolean
}

export interface PullRequestReviewSummary {
  approved_count: number
  changes_requested_count: number
  approved_by: User[]
}

export interface PullRequestDetail {
  pull_request: PullRequest
  author: User
  compare: CompareResult | null
  review_summary: PullRequestReviewSummary
}

export interface PullRequestComment {
  id: string
  pull_request_id: string
  author_id: string
  body: string
  path: string | null
  line: number | null
  created_at: string
  updated_at: string
}

export interface PullRequestCommentDetail {
  comment: PullRequestComment
  author: User
}

export interface PullRequestReview {
  id: string
  pull_request_id: string
  reviewer_id: string
  state: 'pending' | 'approved' | 'changes_requested' | 'commented'
  body: string | null
  commit_sha: string | null
  created_at: string
}

export interface PullRequestReviewDetail {
  review: PullRequestReview
  reviewer: User
}

export interface JobMetrics {
  job_name: string
  steps: Array<{
    name: string
    duration_ms: number
    exit_code: number
    started_at: string
    finished_at: string
  }>
  queue_wait_ms: number
  execution_ms: number
  total_ms: number
}

export interface JobArtifact {
  id: string
  job_run_id: string
  name: string
  path: string
  size_bytes: number
  created_at: string
}

export interface JobRun {
  id: string
  job_name: string
  status: 'queued' | 'running' | 'success' | 'failure' | 'cancelled'
  runs_on: string
  image?: string | null
  needs: string[]
  steps: Array<{ name: string; run: string }>
  artifacts: JobArtifact[]
  metrics_json: JobMetrics | null
  log_text: string
  queued_at: string
  started_at: string | null
  finished_at: string | null
}

export interface PipelineJobPreview {
  name: string
  runs_on: string
  image?: string | null
  needs: string[]
  step_count: number
  steps: Array<{ name: string; run: string }>
}

export interface PipelineConfigPreview {
  config_path: string
  commit_sha: string
  ref: string
  jobs: PipelineJobPreview[]
}

export interface PipelineRun {
  id: string
  commit_sha: string
  ref_name: string
  event_type: 'push' | 'pull_request' | 'manual'
  status: 'pending' | 'queued' | 'running' | 'success' | 'failure' | 'cancelled'
  created_at: string
  started_at: string | null
  finished_at: string | null
  jobs: JobRun[]
}

export interface CommitStatus {
  context: string
  state: 'pending' | 'success' | 'failure' | 'error'
  description: string | null
  target_url: string | null
  required: boolean
  updated_at: string
}

export interface RunnerInstance {
  instance_id: string
  host_ip: string | null
  version: string | null
  cpu_cores: number | null
  memory_total_mb: number | null
  memory_used_mb: number | null
  status: 'online' | 'offline'
  last_seen_at: string
}

export interface RunnerK8sPod {
  job_run_id: string
  job_name: string
  k8s_namespace: string
  k8s_job_name: string
  k8s_pod_name: string | null
  phase: string
  created_at: string
}

export interface Runner {
  id: string
  name: string
  labels: string[]
  status: 'online' | 'offline' | 'busy'
  version: string | null
  host_ip: string | null
  host_name: string | null
  cpu_cores: number | null
  memory_total_mb: number | null
  memory_used_mb: number | null
  disk_total_mb: number | null
  disk_free_mb: number | null
  last_job_name: string | null
  last_job_status: string | null
  last_job_at: string | null
  current_job_name: string | null
  last_seen_at: string | null
  created_at: string
  instances: RunnerInstance[]
  k8s_pods: RunnerK8sPod[]
}

export interface RegisterRunnerResponse {
  runner_id: string
  token: string
  api_url: string
}

export interface RotateRunnerTokenResponse {
  token: string
  api_url: string
}

export interface ContainerImageSummary {
  id: string
  name: string
  description: string | null
  linked_repository_id: string | null
  linked_repository_slug: string | null
  tag_count: number
  created_at: string
  updated_at: string
}

export interface ContainerTag {
  name: string
  manifest_digest: string
  commit_sha: string | null
  media_type: string
  size_bytes: number
  created_at: string
  updated_at: string
}

export interface ContainerImageDetail {
  id: string
  name: string
  description: string | null
  linked_repository_id: string | null
  linked_repository_slug: string | null
  created_at: string
  updated_at: string
  tags: ContainerTag[]
}

export interface RegistryGcReport {
  blobs_removed: number
  upload_files_removed: number
}

export type AuthProviderType = 'oidc' | 'saml' | 'ldap'

export interface AuthProviderPublic {
  id: string
  name: string
  provider_type: AuthProviderType
}

export interface AuthProviderAdmin {
  id: string
  name: string
  provider_type: AuthProviderType
  enabled: boolean
  issuer_url: string | null
  client_id: string | null
  has_client_secret: boolean
  scopes: string
  idp_entity_id: string | null
  idp_sso_url: string | null
  has_idp_certificate: boolean
  sp_entity_id: string | null
  ldap_url: string | null
  ldap_bind_dn: string | null
  has_ldap_bind_password: boolean
  ldap_base_dn: string | null
  ldap_user_filter: string
  ldap_email_attr: string
  ldap_display_name_attr: string
  ldap_username_attr: string
  ldap_group_filter: string
  created_at: string
  updated_at: string
  ldap_mappings?: LdapGroupMapping[]
}

export interface LdapGroupMapping {
  id: string
  provider_id: string
  ldap_group_dn: string
  organization_id: string
  org_role: 'owner' | 'admin' | 'member'
  created_at: string
  organization_slug: string
  organization_name: string
}

export type AuditEventType =
  | 'login'
  | 'sso_login'
  | 'repo_access'
  | 'permission_change'
  | 'merge'

export interface AuditEvent {
  id: string
  organization_id: string | null
  actor: User | null
  event_type: AuditEventType
  action: string
  resource_type: string | null
  resource_id: string | null
  metadata: Record<string, unknown>
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export interface AuditListResponse {
  events: AuditEvent[]
  total: number
}

export type CiSecretKind = 'variable' | 'file'

export interface CiSecret {
  id: string
  name: string
  secret_kind: CiSecretKind
  created_at: string
  updated_at: string
}
