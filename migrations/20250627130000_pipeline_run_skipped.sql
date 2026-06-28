-- Pipeline run with no runnable jobs (all jobs skipped by if: / needs)
ALTER TYPE pipeline_run_status ADD VALUE IF NOT EXISTS 'skipped';
