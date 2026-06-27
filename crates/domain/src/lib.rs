pub mod auth;
pub mod branch_protection;
pub mod error;
pub mod models;
pub mod permissions;

pub use branch_protection::branch_matches_pattern;
pub use error::DomainError;
pub use permissions::{
    max_repo_role, max_repo_role_pair, repo_role_allows_admin, repo_role_allows_read,
    repo_role_allows_write, CustomRolePermissions,
};
