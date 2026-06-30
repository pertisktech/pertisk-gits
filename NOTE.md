## Build (packages + Docker images)

```sh
export VERSION=0.1.87
./build.sh
```

Builds pertisk-gits and pertisk-runner DEB/RPM (amd64 + arm64) and pushes multi-arch Docker images.

## Deploy (all hosts, uses artifacts from build)

```sh
export VERSION=0.1.87
./build.sh   # skip if release/ already has this version
./deploy.sh
```

Or build and deploy in one step: `VERSION=0.1.87 ./build-deploy.sh`

## Deploy git server only

```sh
make deploy-rpm DEPLOY_HOST=nat@103.117.150.228 VERSION=0.1.87
```

## Deploy git runner only

```sh
make install-runner DEPLOY_HOST=nat@103.117.150.228 VERSION=0.1.87
make install-runner DEPLOY_HOST=almalinux@10.1.1.14 VERSION=0.1.87
make install-runner DEPLOY_HOST=root@135.181.197.40 VERSION=0.1.87
```
