use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "auth_provider_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum AuthProviderType {
    Oidc,
    Saml,
    Ldap,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "audit_event_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum AuditEventType {
    Login,
    SsoLogin,
    RepoAccess,
    PermissionChange,
    Merge,
    Import,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "import_provider", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ImportProvider {
    Github,
    Gitlab,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "import_job_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ImportJobStatus {
    Pending,
    Mirroring,
    Metadata,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: Option<String>,
    pub display_name: Option<String>,
    pub is_super_admin: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Organization {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "org_role", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum OrgRole {
    Owner,
    Admin,
    Member,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct OrganizationMember {
    pub organization_id: Uuid,
    pub user_id: Uuid,
    pub role: OrgRole,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "repo_visibility", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum RepoVisibility {
    Public,
    Private,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "repo_role", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum RepoRole {
    Admin,
    Write,
    Read,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Repository {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub visibility: RepoVisibility,
    pub default_branch: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RepositoryPermission {
    pub repository_id: Uuid,
    pub user_id: Uuid,
    pub role: RepoRole,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ApiToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    #[serde(skip_serializing)]
    pub token_hash: String,
    pub scopes: Vec<String>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RepositoryDeployKey {
    pub id: Uuid,
    pub repository_id: Uuid,
    pub title: String,
    pub public_key: String,
    pub fingerprint: String,
    pub read_only: bool,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateDeployKeyRequest {
    #[validate(length(min = 1, max = 255))]
    pub title: String,
    #[validate(length(min = 1))]
    pub public_key: String,
    #[serde(default = "default_read_only_deploy_key")]
    pub read_only: bool,
}

fn default_read_only_deploy_key() -> bool {
    true
}

#[derive(Debug, Deserialize, Validate)]
pub struct RegisterRequest {
    #[validate(length(min = 3, max = 39))]
    pub username: String,
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 8, max = 128))]
    pub password: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct LoginRequest {
    #[validate(length(min = 1))]
    pub login: String,
    #[validate(length(min = 1))]
    pub password: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct AdminCreateUserRequest {
    #[validate(length(min = 3, max = 39))]
    pub username: String,
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 8, max = 128))]
    pub password: String,
    pub display_name: Option<String>,
    pub is_super_admin: Option<bool>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct AdminUpdateUserRequest {
    #[validate(length(min = 3, max = 39))]
    pub username: Option<String>,
    #[validate(email)]
    pub email: Option<String>,
    #[validate(length(min = 8, max = 128))]
    pub password: Option<String>,
    pub display_name: Option<String>,
    pub is_super_admin: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserPublic,
    pub is_super_admin: bool,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct UserPublic {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    pub display_name: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateOrganizationRequest {
    #[validate(length(min = 1, max = 100))]
    pub name: String,
    #[validate(length(min = 1, max = 100))]
    pub slug: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateOrganizationRequest {
    #[validate(length(min = 1, max = 100))]
    pub name: Option<String>,
    #[validate(length(min = 1, max = 100))]
    pub slug: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateRepositoryRequest {
    #[validate(length(min = 1, max = 100))]
    pub name: String,
    #[validate(length(min = 1, max = 100))]
    pub slug: String,
    pub description: Option<String>,
    pub visibility: Option<RepoVisibility>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserSshKey {
    pub id: Uuid,
    pub user_id: Uuid,
    pub title: String,
    pub public_key: String,
    pub fingerprint: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateSshKeyRequest {
    #[validate(length(min = 1, max = 255))]
    pub title: String,
    #[validate(length(min = 1))]
    pub public_key: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateRepositoryRequest {
    #[validate(length(min = 1, max = 255))]
    pub name: Option<String>,
    pub description: Option<String>,
    pub visibility: Option<RepoVisibility>,
    #[validate(length(min = 1, max = 255))]
    pub default_branch: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct AddOrganizationMemberRequest {
    pub username: Option<String>,
    pub user_id: Option<Uuid>,
    pub role: Option<OrgRole>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateOrganizationMemberRequest {
    pub role: OrgRole,
}

#[derive(Debug, Deserialize, Validate)]
pub struct AddRepositoryCollaboratorRequest {
    pub username: Option<String>,
    pub user_id: Option<Uuid>,
    pub role: Option<RepoRole>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateRepositoryCollaboratorRequest {
    pub role: RepoRole,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "issue_state", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum IssueState {
    Open,
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "milestone_state", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum MilestoneState {
    Open,
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pr_state", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum PullRequestState {
    Open,
    Closed,
    Merged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "review_state", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ReviewState {
    Pending,
    Approved,
    ChangesRequested,
    Commented,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Label {
    pub id: Uuid,
    pub repository_id: Uuid,
    pub name: String,
    pub color: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Milestone {
    pub id: Uuid,
    pub repository_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub due_on: Option<chrono::NaiveDate>,
    pub state: MilestoneState,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Issue {
    pub id: Uuid,
    pub repository_id: Uuid,
    pub number: i32,
    pub author_id: Uuid,
    pub assignee_id: Option<Uuid>,
    pub milestone_id: Option<Uuid>,
    pub title: String,
    pub body: String,
    pub state: IssueState,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub closed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct IssueComment {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub author_id: Uuid,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PullRequest {
    pub id: Uuid,
    pub repository_id: Uuid,
    pub number: i32,
    pub author_id: Uuid,
    pub title: String,
    pub body: String,
    pub source_branch: String,
    pub target_branch: String,
    pub state: PullRequestState,
    pub merge_commit_sha: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub merged_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PullRequestReview {
    pub id: Uuid,
    pub pull_request_id: Uuid,
    pub reviewer_id: Uuid,
    pub state: ReviewState,
    pub body: Option<String>,
    pub commit_sha: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct PullRequestReviewSummary {
    pub approved_count: i32,
    pub changes_requested_count: i32,
    pub approved_by: Vec<UserPublic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PullRequestComment {
    pub id: Uuid,
    pub pull_request_id: Uuid,
    pub author_id: Uuid,
    pub body: String,
    pub path: Option<String>,
    pub line: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateLabelRequest {
    #[validate(length(min = 1, max = 100))]
    pub name: String,
    #[validate(length(min = 4, max = 7))]
    pub color: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateMilestoneRequest {
    #[validate(length(min = 1, max = 255))]
    pub title: String,
    pub description: Option<String>,
    pub due_on: Option<chrono::NaiveDate>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateIssueRequest {
    #[validate(length(min = 1, max = 255))]
    pub title: String,
    pub body: Option<String>,
    pub assignee_id: Option<Uuid>,
    pub milestone_id: Option<Uuid>,
    pub label_ids: Option<Vec<Uuid>>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateIssueRequest {
    #[validate(length(min = 1, max = 255))]
    pub title: Option<String>,
    pub body: Option<String>,
    pub state: Option<IssueState>,
    pub assignee_id: Option<Option<Uuid>>,
    pub milestone_id: Option<Option<Uuid>>,
    pub label_ids: Option<Vec<Uuid>>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateIssueCommentRequest {
    #[validate(length(min = 1))]
    pub body: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreatePullRequestRequest {
    #[validate(length(min = 1, max = 255))]
    pub title: String,
    pub body: Option<String>,
    #[validate(length(min = 1, max = 255))]
    pub source_branch: String,
    #[validate(length(min = 1, max = 255))]
    pub target_branch: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdatePullRequestRequest {
    #[validate(length(min = 1, max = 255))]
    pub title: Option<String>,
    pub body: Option<String>,
    pub state: Option<PullRequestState>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreatePullRequestCommentRequest {
    #[validate(length(min = 1))]
    pub body: String,
    pub path: Option<String>,
    pub line: Option<i32>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreatePullRequestReviewRequest {
    pub state: ReviewState,
    pub body: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MergePullRequestRequest {
    pub merge_strategy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AuthProvider {
    pub id: Uuid,
    pub name: String,
    pub provider_type: AuthProviderType,
    pub enabled: bool,
    pub issuer_url: Option<String>,
    pub client_id: Option<String>,
    #[serde(skip_serializing)]
    pub client_secret: Option<String>,
    pub scopes: String,
    pub idp_entity_id: Option<String>,
    pub idp_sso_url: Option<String>,
    #[serde(skip_serializing)]
    pub idp_certificate: Option<String>,
    pub sp_entity_id: Option<String>,
    pub ldap_url: Option<String>,
    pub ldap_bind_dn: Option<String>,
    #[serde(skip_serializing)]
    pub ldap_bind_password: Option<String>,
    pub ldap_base_dn: Option<String>,
    pub ldap_user_filter: String,
    pub ldap_email_attr: String,
    pub ldap_display_name_attr: String,
    pub ldap_username_attr: String,
    pub ldap_group_filter: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LdapGroupMapping {
    pub id: Uuid,
    pub provider_id: Uuid,
    pub ldap_group_dn: String,
    pub organization_id: Uuid,
    pub org_role: OrgRole,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AuditEvent {
    pub id: Uuid,
    pub organization_id: Option<Uuid>,
    pub actor_user_id: Option<Uuid>,
    pub event_type: AuditEventType,
    pub action: String,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub metadata: serde_json::Value,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AuthProviderPublic {
    pub id: Uuid,
    pub name: String,
    pub provider_type: AuthProviderType,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateAuthProviderRequest {
    #[validate(length(min = 1, max = 255))]
    pub name: String,
    pub provider_type: AuthProviderType,
    pub enabled: Option<bool>,
    pub issuer_url: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub scopes: Option<String>,
    pub idp_entity_id: Option<String>,
    pub idp_sso_url: Option<String>,
    pub idp_certificate: Option<String>,
    pub sp_entity_id: Option<String>,
    pub ldap_url: Option<String>,
    pub ldap_bind_dn: Option<String>,
    pub ldap_bind_password: Option<String>,
    pub ldap_base_dn: Option<String>,
    pub ldap_user_filter: Option<String>,
    pub ldap_email_attr: Option<String>,
    pub ldap_display_name_attr: Option<String>,
    pub ldap_username_attr: Option<String>,
    pub ldap_group_filter: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateAuthProviderRequest {
    #[validate(length(min = 1, max = 255))]
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub issuer_url: Option<String>,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub scopes: Option<String>,
    pub idp_entity_id: Option<String>,
    pub idp_sso_url: Option<String>,
    pub idp_certificate: Option<String>,
    pub sp_entity_id: Option<String>,
    pub ldap_url: Option<String>,
    pub ldap_bind_dn: Option<String>,
    pub ldap_bind_password: Option<String>,
    pub ldap_base_dn: Option<String>,
    pub ldap_user_filter: Option<String>,
    pub ldap_email_attr: Option<String>,
    pub ldap_display_name_attr: Option<String>,
    pub ldap_username_attr: Option<String>,
    pub ldap_group_filter: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateLdapGroupMappingRequest {
    #[validate(length(min = 1))]
    pub ldap_group_dn: String,
    pub organization_id: Uuid,
    pub org_role: Option<OrgRole>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct LdapLoginRequest {
    #[validate(length(min = 1))]
    pub username: String,
    #[validate(length(min = 1))]
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ImportCredential {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub user_id: Uuid,
    pub provider: ImportProvider,
    pub base_url: Option<String>,
    pub label: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ImportJob {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub created_by: Uuid,
    pub credential_id: Uuid,
    pub provider: ImportProvider,
    pub import_issues: bool,
    pub import_pull_requests: bool,
    pub status: ImportJobStatus,
    pub error_message: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ImportJobRepo {
    pub id: Uuid,
    pub job_id: Uuid,
    pub source_id: String,
    pub source_full_name: String,
    pub source_clone_url: String,
    pub target_slug: String,
    pub target_name: String,
    pub description: Option<String>,
    pub visibility: RepoVisibility,
    pub default_branch: Option<String>,
    pub repository_id: Option<Uuid>,
    pub status: ImportJobStatus,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct BranchProtectionRule {
    pub id: Uuid,
    pub repository_id: Uuid,
    pub branch_pattern: String,
    pub require_pull_request: bool,
    pub required_approvals: i32,
    pub require_status_checks: bool,
    pub allow_force_push: bool,
    pub allow_admin_bypass: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateBranchProtectionRequest {
    #[validate(length(min = 1, max = 255))]
    pub branch_pattern: String,
    pub require_pull_request: Option<bool>,
    pub required_approvals: Option<i32>,
    pub require_status_checks: Option<bool>,
    pub allow_force_push: Option<bool>,
    pub allow_admin_bypass: Option<bool>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateBranchProtectionRequest {
    #[validate(length(min = 1, max = 255))]
    pub branch_pattern: Option<String>,
    pub require_pull_request: Option<bool>,
    pub required_approvals: Option<i32>,
    pub require_status_checks: Option<bool>,
    pub allow_force_push: Option<bool>,
    pub allow_admin_bypass: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WikiPage {
    pub id: Uuid,
    pub repository_id: Uuid,
    pub slug: String,
    pub title: String,
    pub body: String,
    pub author_id: Uuid,
    pub parent_slug: Option<String>,
    pub position: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WikiPageRevision {
    pub id: Uuid,
    pub page_id: Uuid,
    pub author_id: Uuid,
    pub title: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateWikiPageRequest {
    #[validate(length(min = 1, max = 255))]
    pub title: String,
    pub slug: Option<String>,
    pub body: Option<String>,
    pub parent_slug: Option<String>,
    pub position: Option<i32>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateWikiPageRequest {
    #[validate(length(min = 1, max = 255))]
    pub title: Option<String>,
    pub body: Option<String>,
    pub parent_slug: Option<String>,
    pub position: Option<i32>,
}

