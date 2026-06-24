use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub display_name: Option<String>,
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

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserPublic,
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
