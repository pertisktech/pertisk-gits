-- GitLab-style nested groups: parent_id + globally unique full_path (e.g. a/b/c).

ALTER TABLE organizations
    ADD COLUMN parent_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    ADD COLUMN full_path VARCHAR(500);

UPDATE organizations SET full_path = slug WHERE full_path IS NULL;

ALTER TABLE organizations
    ALTER COLUMN full_path SET NOT NULL;

ALTER TABLE organizations DROP CONSTRAINT organizations_slug_key;

CREATE UNIQUE INDEX organizations_full_path_key ON organizations (full_path);
CREATE UNIQUE INDEX organizations_parent_slug_key ON organizations (parent_id, slug);
CREATE UNIQUE INDEX organizations_root_slug_key ON organizations (slug) WHERE parent_id IS NULL;

CREATE INDEX organizations_parent_id_idx ON organizations (parent_id);
