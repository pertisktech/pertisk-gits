use serde::{Deserialize, Serialize};

use crate::models::RepoRole;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct CustomRolePermissions {
    #[serde(default)]
    pub manage_members: bool,
    #[serde(default)]
    pub manage_settings: bool,
    #[serde(default)]
    pub view_audit: bool,
    #[serde(default)]
    pub manage_teams: bool,
    #[serde(default)]
    pub manage_custom_roles: bool,
    #[serde(default)]
    pub create_repositories: bool,
    #[serde(default)]
    pub manage_org_secrets: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_repo_access: Option<RepoRole>,
}

impl CustomRolePermissions {
    pub fn can_manage_members(&self) -> bool {
        self.manage_members
    }

    pub fn can_manage_settings(&self) -> bool {
        self.manage_settings
    }

    pub fn can_view_audit(&self) -> bool {
        self.view_audit
    }

    pub fn can_manage_teams(&self) -> bool {
        self.manage_teams
    }

    pub fn can_manage_custom_roles(&self) -> bool {
        self.manage_custom_roles
    }

    pub fn can_create_repositories(&self) -> bool {
        self.create_repositories
    }

    pub fn can_manage_org_secrets(&self) -> bool {
        self.manage_org_secrets
    }
}

pub fn max_repo_role(a: Option<RepoRole>, b: Option<RepoRole>) -> Option<RepoRole> {
    match (a, b) {
        (None, b) => b,
        (a, None) => a,
        (Some(left), Some(right)) => Some(max_repo_role_pair(left, right)),
    }
}

pub fn max_repo_role_pair(left: RepoRole, right: RepoRole) -> RepoRole {
    use RepoRole::*;
    match (left, right) {
        (Admin, _) | (_, Admin) => Admin,
        (Write, Write) => Write,
        (Write, Read) | (Read, Write) => Write,
        (Read, Read) => Read,
    }
}

pub fn repo_role_allows_read(_role: RepoRole) -> bool {
    true
}

pub fn repo_role_allows_write(role: RepoRole) -> bool {
    matches!(role, RepoRole::Write | RepoRole::Admin)
}

pub fn repo_role_allows_admin(role: RepoRole) -> bool {
    matches!(role, RepoRole::Admin)
}
