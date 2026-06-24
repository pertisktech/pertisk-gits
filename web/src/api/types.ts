export interface User {
  id: string
  username: string
  email: string
  display_name: string | null
  created_at: string
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

export interface JobRun {
  id: string
  job_name: string
  status: 'queued' | 'running' | 'success' | 'failure' | 'cancelled'
  runs_on: string
  metrics_json: JobMetrics | null
  log_text: string
  queued_at: string
  started_at: string | null
  finished_at: string | null
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
  updated_at: string
}
