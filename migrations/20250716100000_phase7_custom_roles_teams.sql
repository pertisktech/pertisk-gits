-- Phase 7: custom org roles and teams with repository access templates

CREATE TABLE organization_custom_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, slug),
    UNIQUE (organization_id, name)
);

ALTER TABLE organization_members
    ADD COLUMN custom_role_id UUID REFERENCES organization_custom_roles(id) ON DELETE SET NULL;

CREATE INDEX idx_org_custom_roles_org ON organization_custom_roles(organization_id);
CREATE INDEX idx_org_members_custom_role ON organization_members(custom_role_id);

CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, slug),
    UNIQUE (organization_id, name)
);

CREATE TABLE team_members (
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);

CREATE TABLE team_repository_permissions (
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    role repo_role NOT NULL DEFAULT 'read',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, repository_id)
);

CREATE INDEX idx_teams_org ON teams(organization_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);
CREATE INDEX idx_team_repo_permissions_repo ON team_repository_permissions(repository_id);
