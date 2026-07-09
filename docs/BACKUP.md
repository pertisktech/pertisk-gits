# Backup and Restore (GitLab-style CLI)

For large installations (for example up to 100 GB), use the server-side CLI helper instead of web upload/download.

The preferred implementation is the Rust binary (`pertisk-backup`) for better reliability and packaging.

## Command

Build from project root:

```bash
cargo build --release -p pertisk-backup
```

Run directly via Cargo:

```bash
cargo run -p pertisk-backup -- help
```

Or run the shell wrapper (kept for compatibility):

```bash
scripts/pertisk-backup help
```

Optional install as system command from compiled binary:

```bash
sudo install -m 0755 target/release/pertisk-backup /usr/local/bin/pertisk-backup
```

When installed from `pertisk-gits` DEB/RPM package, `pertisk-backup` is already available at `/usr/bin/pertisk-backup`.

Then you can run:

```bash
sudo pertisk-backup create
sudo pertisk-backup restore BACKUP=<backup_id> CONFIRM=RESTORE
```

`pertisk-backup` automatically loads variables from `/etc/pertisk-gits/pertisk-gits.conf` when present,
so `DATABASE_URL`, `REPOS_ROOT`, `REGISTRY_ROOT`, `ARTIFACTS_ROOT`, and `BACKUPS_ROOT` can be managed in one place.

To use a different config file path:

```bash
sudo PERTISK_CONFIG_FILE=/path/to/pertisk-gits.conf pertisk-backup create
```

## GitLab-style examples

Create and skip repositories:

```bash
sudo pertisk-backup create SKIP=repositories
```

Restore by backup id:

```bash
sudo pertisk-backup restore BACKUP=11493107454_2018_04_25_10.6.4-ce CONFIRM=RESTORE
```

## Supported SKIP values

- `db`
- `repositories`
- `registry`
- `artifacts`
- `tar` (keep unpacked backup directory only)
- `remote` (do not upload/download object storage)

Example:

```bash
sudo pertisk-backup create SKIP=db,artifacts
sudo pertisk-backup restore BACKUP=<backup_id> SKIP=registry CONFIRM=RESTORE
```

## S3 / MinIO / RustFS object storage

The helper uses S3-compatible APIs through AWS CLI.

```bash
export BACKUP_STORAGE=s3
export S3_ENDPOINT=http://127.0.0.1:9000      # MinIO/RustFS endpoint, optional for AWS
export S3_BUCKET=pertisk-backup
export S3_PREFIX=prod
export S3_ACCESS_KEY=pertisk
export S3_SECRET_KEY=pertisksecret

sudo -E pertisk-backup create
```

You can also set one destination URI:

```bash
export BACKUP_STORAGE=s3
export BACKUP_S3_URI=s3://pertisk-backup/prod
sudo -E pertisk-backup create
```

Restore will download from object storage automatically if local archive is missing:

```bash
sudo -E pertisk-backup restore BACKUP=<backup_id> CONFIRM=RESTORE
```

## Required runtime tools

- `tar`
- `pg_dump` for DB backup (unless `SKIP=db`)
- `psql` for DB restore (unless `SKIP=db`)
- `aws` CLI for remote object storage

## Important restore prerequisites

- Use the same application/database schema version as backup source.
- Restore config and secrets outside backup archive: `.env`, JWT secret, SSH host key (`data/ssh_host_key`), and any TLS certs.
- Restart service after restore so DB connections are refreshed.

Example service flow:

```bash
sudo systemctl stop pertisk-gits
sudo -E pertisk-backup restore BACKUP=<backup_id> CONFIRM=RESTORE
sudo systemctl start pertisk-gits
```

## Makefile shortcuts

```bash
make backup-create SKIP=repositories
make backup-list
make backup-restore BACKUP=<backup_id> CONFIRM=RESTORE
```
