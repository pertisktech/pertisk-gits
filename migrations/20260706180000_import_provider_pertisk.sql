-- Import git mirrors from another Pertisk Gits instance.

ALTER TYPE import_provider ADD VALUE IF NOT EXISTS 'pertisk';
