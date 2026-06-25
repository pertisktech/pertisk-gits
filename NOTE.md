## Deploy (all hosts)

```sh
export VERSION=0.1.87
./deploy.sh
```

Or override: `VERSION=0.1.87 ./deploy.sh`

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
