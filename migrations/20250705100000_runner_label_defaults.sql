-- Normalize legacy runner labels and job runs_on values

ALTER TABLE runners ALTER COLUMN labels SET DEFAULT '{}';
ALTER TABLE job_runs ALTER COLUMN runs_on SET DEFAULT 'linux';

UPDATE runners
SET labels = COALESCE(
    (
        SELECT array_agg(DISTINCT replaced ORDER BY replaced)
        FROM (
            SELECT CASE WHEN elem = 'self-hosted' THEN 'linux' ELSE elem END AS replaced
            FROM unnest(labels) AS elem
        ) AS mapped
    ),
    '{}'
)
WHERE 'self-hosted' = ANY (labels);

UPDATE job_runs
SET runs_on = 'linux'
WHERE runs_on = 'self-hosted';
