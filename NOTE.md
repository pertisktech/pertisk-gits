## Deploy git server
```sh
make deploy-rpm DEPLOY_HOST=nat@103.117.150.228 VERSION=0.1.38
```

## Deploy git runner
```sh
make install-runner DEPLOY_HOST=nat@103.117.150.228 VERSION=0.1.37
make install-runner DEPLOY_HOST=almalinux@10.1.1.14 VERSION=0.1.4
```