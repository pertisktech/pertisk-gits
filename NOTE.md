## Build (packages + Docker images)

```sh
export VERSION=0.1.89
./scripts/build.sh
```

Builds pertisk-gits and pertisk-runner DEB/RPM (amd64 + arm64).

## Deploy (hosts from hosts.local.sh)

```sh
cp scripts/hosts.local.example.sh scripts/hosts.local.sh   # once; edit privately
export VERSION=0.1.89
./scripts/build.sh   # skip if release/ already has this version
./scripts/deploy.sh
```

Or build and deploy in one step: `VERSION=0.1.89 ./scripts/build-deploy.sh`

## Deploy a single host

```sh
make deploy-rpm DEPLOY_HOST=user@host VERSION=0.1.89
make install-runner DEPLOY_HOST=user@host VERSION=0.1.89
```

## Before making the repo public

Rotate secrets that appeared in git history (even after this scrub):

1. Postgres password previously in `Makefile` / local `.env` — change the DB password and update `.env` / server conf.
2. Runner token previously in `deploy-runner.sh` — revoke/re-register; put the new token only in `scripts/hosts.local.sh` or a Kubernetes Secret.
