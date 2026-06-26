-- Per-pod heartbeats (Helm replica pool) and Kubernetes executor job pods.

CREATE TABLE IF NOT EXISTS runner_instances (
    runner_id UUID NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
    instance_id TEXT NOT NULL,
    host_ip VARCHAR(45),
    version VARCHAR(32),
    cpu_cores INTEGER,
    memory_total_mb BIGINT,
    memory_used_mb BIGINT,
    disk_total_mb BIGINT,
    disk_free_mb BIGINT,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (runner_id, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_runner_instances_last_seen
    ON runner_instances (runner_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS runner_k8s_pods (
    job_run_id UUID PRIMARY KEY REFERENCES job_runs(id) ON DELETE CASCADE,
    runner_id UUID NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
    k8s_namespace TEXT NOT NULL,
    k8s_job_name TEXT NOT NULL,
    k8s_pod_name TEXT,
    phase TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_runner_k8s_pods_runner_active
    ON runner_k8s_pods (runner_id, created_at DESC)
    WHERE finished_at IS NULL;
