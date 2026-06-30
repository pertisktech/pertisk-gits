CREATE TABLE smtp_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    host TEXT NOT NULL DEFAULT '',
    port INTEGER NOT NULL DEFAULT 587,
    username TEXT,
    password_encrypted BYTEA,
    from_email TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT 'Pertisk Gits',
    use_tls BOOLEAN NOT NULL DEFAULT TRUE,
    notify_login BOOLEAN NOT NULL DEFAULT FALSE,
    notify_merge_request BOOLEAN NOT NULL DEFAULT TRUE,
    notify_pipeline_failure BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO smtp_settings (id) VALUES (1);
