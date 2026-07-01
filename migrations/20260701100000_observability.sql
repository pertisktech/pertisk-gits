CREATE TABLE observability_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    http_logging_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    error_logging_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    log_level TEXT NOT NULL DEFAULT 'info',
    prometheus_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO observability_settings (id) VALUES (1);
