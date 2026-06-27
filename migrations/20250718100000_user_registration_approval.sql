CREATE TYPE user_approval_status AS ENUM ('pending', 'approved', 'rejected');

ALTER TABLE users
    ADD COLUMN approval_status user_approval_status NOT NULL DEFAULT 'approved',
    ADD COLUMN approved_at TIMESTAMPTZ,
    ADD COLUMN approved_by UUID REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX idx_users_approval_status ON users (approval_status);
