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
}

export interface TreeEntry {
  name: string
  path: string
  kind: 'blob' | 'tree' | string
  mode: string
  size: number | null
}

export interface CommitInfo {
  sha: string
  short_sha: string
  author_name: string
  author_email: string
  committed_at: number
  message: string
}

export interface RepoBrowser {
  branches: string[]
  default_ref: string
  empty: boolean
}

export interface AuthResponse {
  token: string
  user: User
}
