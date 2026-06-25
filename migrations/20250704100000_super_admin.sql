-- Platform super-admin flag (instance-wide administration)

ALTER TABLE users ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_users_super_admin ON users (is_super_admin) WHERE is_super_admin = TRUE;
