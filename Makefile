.PHONY: build build-local build-package check test test-api run run-h3-gateway h3-dev-certs run-release \
	infra infra-down dev-infra install-web web-dist web-dist-docker fix-perms fix-web-dist-owner \
	dev dev-vite dev-local dev-serve dev-web dev-stop \
	package package-clean package-amd64 package-arm64 package-deb package-rpm \
	package-runner package-runner-clean package-runner-amd64 package-runner-arm64 \
	release release-amd release-arm \
	deploy deploy-package deploy-remote deploy-deb deploy-rpm deploy-rpm-arm64 \
	install-runner deploy-runner-deb deploy-runner-rpm deploy-runner-rpm-arm64 \
	backup-cli-build backup-create backup-restore backup-list \
	runner-image runner-image-push runner-image-arm64 runner-image-multi runner-compose-up runner-compose-down \
	pertisk-gits-image pertisk-gits-image-push pertisk-gits-image-arm64 pertisk-gits-image-multi \
	helm-runner-lint helm-runner-template helm-runner-install helm-runner-upgrade \
	helm-gits-lint helm-gits-template helm-gits-talos-template helm-gits-talos-install

CARGO ?= cargo
CARGO_BUILD_JOBS ?= 4
COMPOSE ?= docker compose -f deploy/docker-compose.yml

VERSION ?= $(shell git describe --tags --always 2>/dev/null | sed 's/^v//' || echo "0.1.0")
PACKAGE_TARGET ?= all
BUILDER_NAME ?= pertisk-gits-package
CACHE_DIR ?= .buildx-cache/gits

# Dev
DEV_API_PORT ?= 8080
DEV_USER ?= $(if $(SUDO_USER),$(SUDO_USER),$(USER))
RUN_AS_USER = $(if $(filter root,$(USER)),sudo -u $(DEV_USER) ,)

# Remote dev DB (Talos / shared Postgres). Override: make dev DEV_DATABASE_URL=...
# Or set DATABASE_URL in .env (gitignored).
-include .env
DEV_DATABASE_URL ?= postgres://postgres:c2UT3eavGQ7eEykq@localhost:5432/pertisk_local_gits
ifneq ($(strip $(DATABASE_URL)),)
DEV_DATABASE_URL := $(DATABASE_URL)
endif
# Set DEV_USE_LOCAL_DB=1 to start docker-compose Postgres on localhost instead.
DEV_USE_LOCAL_DB ?= 0
DEV_LOCAL_DATABASE_URL ?= postgres://pertisk:pertisk@localhost:5432/pertisk_gits
ifeq ($(DEV_USE_LOCAL_DB),1)
DEV_ACTIVE_DATABASE_URL := $(DEV_LOCAL_DATABASE_URL)
else
DEV_ACTIVE_DATABASE_URL := $(DEV_DATABASE_URL)
endif
DEV_EXPORT_ENV = DATABASE_URL='$(DEV_ACTIVE_DATABASE_URL)' PERTISK_VERSION='$(VERSION)'

# Remote deploy — use DEPLOY_HOST=user@host (like pertisk-proxy) or REMOTE_USER + REMOTE_HOST
DEPLOY_HOST ?=
DEPLOY_ARCH ?= auto
DEPLOY_BIN ?= pertisk-gits
DEPLOY_PKG ?= auto
DEPLOY_SSH_OPTS ?=

REMOTE_HOST ?=
REMOTE_USER ?= root
PACKAGE_NAME ?= pertisk-gits
REMOTE_PATH ?= /tmp
PACKAGE_CLEAN ?= 1
PACKAGE_BUILD ?= 1

# --- Local build (native macOS/Linux binary) ---
build-local: web-dist
	PERTISK_VERSION=$(VERSION) $(CARGO) build --release -p pertisk-api

# --- Linux package for server deploy (DEB + RPM + tarball → release/) ---
build: build-package

build-package: package-amd64

check:
	$(CARGO) check --workspace

test:
	$(CARGO) test --workspace

test-api:
	$(CARGO) test -p pertisk-api --lib

test-coverage:
	./scripts/coverage.sh

backup-cli-build:
	$(CARGO) build --release -p pertisk-backup

backup-create:
	$(CARGO) run -p pertisk-backup -- create \
	SKIP='$(SKIP)' BACKUP='$(BACKUP)' BACKUPS_ROOT='$(BACKUPS_ROOT)' DATABASE_URL='$(DATABASE_URL)' \
	REPOS_ROOT='$(REPOS_ROOT)' REGISTRY_ROOT='$(REGISTRY_ROOT)' ARTIFACTS_ROOT='$(ARTIFACTS_ROOT)' \
	BACKUP_STORAGE='$(BACKUP_STORAGE)' BACKUP_S3_URI='$(BACKUP_S3_URI)' S3_ENDPOINT='$(S3_ENDPOINT)' \
	S3_BUCKET='$(S3_BUCKET)' S3_PREFIX='$(S3_PREFIX)' S3_ACCESS_KEY='$(S3_ACCESS_KEY)' \
	S3_SECRET_KEY='$(S3_SECRET_KEY)'

backup-restore:
	$(CARGO) run -p pertisk-backup -- restore \
	SKIP='$(SKIP)' BACKUP='$(BACKUP)' BACKUPS_ROOT='$(BACKUPS_ROOT)' DATABASE_URL='$(DATABASE_URL)' \
	REPOS_ROOT='$(REPOS_ROOT)' REGISTRY_ROOT='$(REGISTRY_ROOT)' ARTIFACTS_ROOT='$(ARTIFACTS_ROOT)' \
	BACKUP_STORAGE='$(BACKUP_STORAGE)' BACKUP_S3_URI='$(BACKUP_S3_URI)' S3_ENDPOINT='$(S3_ENDPOINT)' \
	S3_BUCKET='$(S3_BUCKET)' S3_PREFIX='$(S3_PREFIX)' S3_ACCESS_KEY='$(S3_ACCESS_KEY)' \
	S3_SECRET_KEY='$(S3_SECRET_KEY)' ASSUME_YES='$(ASSUME_YES)' CONFIRM='$(CONFIRM)' \
	DB_RESTORE_CLEAN='$(DB_RESTORE_CLEAN)'

backup-list:
	$(CARGO) run -p pertisk-backup -- list BACKUPS_ROOT='$(BACKUPS_ROOT)'

run:
	$(CARGO) run -p pertisk-api

run-h3-gateway: h3-dev-certs
	GATEWAY_H3_CERT=$(H3_CERT) GATEWAY_H3_KEY=$(H3_KEY) \
	GATEWAY_HTTP_UPSTREAM=$${GATEWAY_HTTP_UPSTREAM:-http://127.0.0.1:8080} \
	$(CARGO) run -p pertisk-h3-gateway

h3-dev-certs:
	@mkdir -p deploy/certs
	@if [ ! -f deploy/certs/h3.crt ] || [ ! -f deploy/certs/h3.key ]; then \
		echo "Generating self-signed dev cert in deploy/certs/ ..."; \
		openssl req -x509 -newkey rsa:2048 -nodes \
			-keyout deploy/certs/h3.key -out deploy/certs/h3.crt -days 365 \
			-subj '/CN=localhost'; \
	fi

H3_CERT ?= deploy/certs/h3.crt
H3_KEY ?= deploy/certs/h3.key

run-release: web-dist
	PERTISK_VERSION=$(VERSION) $(CARGO) run --release -p pertisk-api

# --- Infrastructure (Postgres, Redis, MinIO) ---
infra:
	$(COMPOSE) up -d postgres

infra-down:
	$(COMPOSE) down

.PHONY: dev-infra
dev-infra:
	@if [ "$(DEV_USE_LOCAL_DB)" = "1" ]; then \
		echo "Starting local Postgres (docker compose)..."; \
		$(COMPOSE) up -d postgres; \
	else \
		echo "Using DATABASE_URL ($$(echo '$(DEV_ACTIVE_DATABASE_URL)' | sed 's/:\/\/[^:]*:[^@]*@/:\/\/***:***@/'))"; \
	fi

# --- Web UI (React + Vite) ---
install-web:
	cd web && $(RUN_AS_USER)npm install

fix-perms:
	@if [ "$$(id -u)" -ne 0 ]; then \
		echo "Run: sudo make fix-perms"; exit 1; \
	fi
	chown -R $(DEV_USER):staff web/node_modules web/dist data target 2>/dev/null || true
	@echo "Fixed ownership for web/node_modules, web/dist, data/, and target/"

WEB_VERSION_FILE = web/dist/.app-version

# docker cp (legacy) left root-owned files on macOS; remove so local make targets can clean web/dist.
.PHONY: fix-web-dist-owner
fix-web-dist-owner:
	@if [ -d web/dist ] && find web/dist ! -user $$(id -u) -print -quit 2>/dev/null | grep -q .; then \
		echo "Removing root-owned web/dist (from an older Docker extract)..."; \
		if rm -rf web/dist 2>/dev/null; then \
			:; \
		elif sudo rm -rf web/dist 2>/dev/null; then \
			:; \
		else \
			echo "Cannot remove web/dist. Run once: sudo make fix-perms"; exit 1; \
		fi; \
	fi

.PHONY: web-dist-docker
web-dist-docker:
	@echo "Building web UI via Docker (v$(VERSION))..."
	@$(MAKE) fix-web-dist-owner
	docker build -f docker/Dockerfile.web --build-arg VERSION="$(VERSION)" -t pertisk-web-dist .
	rm -rf web/dist 2>/dev/null || $(MAKE) fix-web-dist-owner
	mkdir -p web/dist
	docker run --rm pertisk-web-dist tar -C /web/dist -cf - . | tar -xf - -C web/dist
	@echo "$(VERSION)" > web/dist/.app-version
	@test -f web/dist/index.html

web-dist:
	@echo "Checking web UI build cache (version $(VERSION))..."
	@skip=0; \
	stored_version=""; \
	if [ -f "$(WEB_VERSION_FILE)" ]; then stored_version="$$(tr -d '[:space:]' < "$(WEB_VERSION_FILE)")"; fi; \
	if [ -d web/dist ] && [ -f web/dist/index.html ]; then \
		if [ -z "$$(find web/src web/public web/index.html web/package.json web/package-lock.json web/vite.config.ts -type f -newer web/dist 2>/dev/null | head -n 1)" ]; then \
			if [ "$$stored_version" = "$(VERSION)" ]; then \
				echo "web/dist is up to date (v$(VERSION)); skipping build."; \
				skip=1; \
			elif [ "$$stored_version" != "$(VERSION)" ]; then \
				echo "web/dist version mismatch (stored=$${stored_version:-missing}, requested=$(VERSION)); rebuilding."; \
			elif [ ! -w web/dist ] 2>/dev/null || { [ -d web/dist/assets ] && [ ! -w web/dist/assets ]; }; then \
				echo "web/dist is read-only; rebuilding after ownership fix."; \
			fi; \
		fi; \
	fi; \
	if [ $$skip -eq 1 ]; then exit 0; fi; \
	if [ -d web/dist/assets ] && [ ! -w web/dist/assets ]; then \
		$(MAKE) fix-web-dist-owner; \
	fi; \
	if [ -d web/dist/assets ] && [ ! -w web/dist/assets ]; then \
		echo "web/dist is not writable (usually from 'sudo make dev'). Run: sudo make fix-perms"; exit 1; \
	fi; \
	if [ $$skip -eq 0 ]; then \
		if ! command -v npm >/dev/null 2>&1 || [ "$(PERTISK_FORCE_DOCKER_BUILD)" = "1" ]; then \
			$(MAKE) web-dist-docker VERSION="$(VERSION)"; \
		else \
			echo "Building web UI (v$(VERSION))..."; \
			if [ ! -d web/node_modules ] || [ ! -f web/node_modules/.package-lock.json ] || [ web/package-lock.json -nt web/node_modules/.package-lock.json ]; then \
				$(MAKE) install-web; \
			fi; \
			rm -rf web/dist 2>/dev/null || { \
				$(MAKE) fix-web-dist-owner; \
				rm -rf web/dist 2>/dev/null || { \
					echo "Cannot clean web/dist. Run: sudo make fix-perms"; exit 1; \
				}; \
			}; \
			cd web && $(RUN_AS_USER)VERSION="$(VERSION)" npm run build && echo "$(VERSION)" > dist/.app-version; \
		fi; \
	fi

dev-web:
	cd web && $(RUN_AS_USER)npm run dev

dev-stop:
	-pkill -f 'cargo-watch.*pertisk-api' 2>/dev/null
	-pkill -f 'cargo-watch watch' 2>/dev/null
	@sleep 0.3
	-pkill -f 'target/debug/pertisk-api' 2>/dev/null
	-pkill -f 'target/release/pertisk-api' 2>/dev/null
	@if command -v lsof >/dev/null 2>&1; then \
		for port in $(DEV_API_PORT) 8081 5173; do \
			pids=$$(lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null); \
			[ -n "$$pids" ] && kill $$pids 2>/dev/null || true; \
		done; \
		sleep 0.3; \
		for port in $(DEV_API_PORT) 8081 5173; do \
			pids=$$(lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null); \
			[ -n "$$pids" ] && kill -9 $$pids 2>/dev/null || true; \
		done; \
	fi
	@echo "Stopped dev processes (if any were running)."

DEV_PREFIX = build/dev-prefix-log.sh
DEV_API_WATCH_IGNORES = -i web -i data -i target -i release -i pkg-pertisk-gits -i pkg-pertisk-runner

# Single-port dev: API serves web/dist. Default DB: DEV_DATABASE_URL (remote).
# Local Postgres: make dev DEV_USE_LOCAL_DB=1
dev: web-dist dev-stop dev-infra
	chmod +x $(DEV_PREFIX)
	$(DEV_EXPORT_ENV) $(CARGO) watch $(DEV_API_WATCH_IGNORES) -x 'run -p pertisk-api' 2>&1 | $(DEV_PREFIX) api

# Hot-reload UI on :5173, API on DEV_API_PORT (Vite proxies /api/v1).
dev-vite: web-dist dev-stop dev-infra
	chmod +x $(DEV_PREFIX)
	$(DEV_EXPORT_ENV) $(CARGO) watch $(DEV_API_WATCH_IGNORES) -x 'run -p pertisk-api' 2>&1 | $(DEV_PREFIX) api & \
	(cd web && $(RUN_AS_USER)npm run dev 2>&1 | $(DEV_PREFIX) vite) & \
	wait

# Legacy: local docker Postgres + localhost DATABASE_URL
dev-local: DEV_USE_LOCAL_DB=1
dev-local: DEV_DATABASE_URL=$(DEV_LOCAL_DATABASE_URL)
dev-local: dev

dev-serve: dev

# --- Packaging: DEB + RPM + tarball (Docker cross-build on macOS) → release/ ---
# Requires: docker (buildx + fpm container on macOS).
# make package              — amd64 + arm64
# make package-amd64        — amd64 only

package-clean:
	rm -f pertisk-gits-linux-amd64 pertisk-gits-linux-arm64 pertisk-backup-linux-amd64 pertisk-backup-linux-arm64 pertisk-worker-linux-amd64 pertisk-worker-linux-arm64
	rm -f pertisk-gits-linux-amd64.version pertisk-gits-linux-arm64.version
	@$(MAKE) fix-web-dist-owner
	rm -rf web/dist
	@echo "Removed Linux binaries and web/dist; next package build will rebuild via Docker."

package-amd64: web-dist
	chmod +x build/docker-common.sh build/package.sh build/deb-rpm.sh build/deploy-remote.sh build/deploy-deb.sh build/deploy-rpm.sh
	PERTISK_FORCE_DOCKER_BUILD="$(PERTISK_FORCE_DOCKER_BUILD)" ./build/package.sh amd64 $(VERSION) $(PACKAGE_TARGET)

package-arm64: web-dist
	chmod +x build/docker-common.sh build/package.sh build/deb-rpm.sh build/deploy-remote.sh build/deploy-deb.sh build/deploy-rpm.sh
	PERTISK_FORCE_DOCKER_BUILD="$(PERTISK_FORCE_DOCKER_BUILD)" ./build/package.sh arm64 $(VERSION) $(PACKAGE_TARGET)

package: package-amd64 package-arm64
	@echo "Done. See release/"

package-deb: package
package-rpm: package

release:
	$(MAKE) package-clean
	$(MAKE) package VERSION=$(VERSION)

release-amd:
	$(MAKE) package-clean
	$(MAKE) package-amd64 VERSION=$(VERSION)

release-arm:
	$(MAKE) package-clean
	$(MAKE) package-arm64 VERSION=$(VERSION)

# --- Deploy (build package + install on remote host) ---
# Primary: make deploy DEPLOY_HOST=user@host VERSION=0.1.0
# AlmaLinux ARM64: make deploy-rpm DEPLOY_HOST=almalinux@10.1.1.233 VERSION=0.2.26
#   (DEPLOY_ARCH=auto detects aarch64 via SSH; override with DEPLOY_ARCH=amd64|arm64)
# Or:      make deploy-deb DEPLOY_HOST=user@host
#          make deploy-rpm DEPLOY_HOST=user@host
#          make deploy-rpm-arm64 DEPLOY_HOST=almalinux@host VERSION=0.2.26

deploy:
	@$(MAKE) deploy-package DEPLOY_HOST="$(DEPLOY_HOST)" REMOTE_HOST="$(REMOTE_HOST)" \
		DEPLOY_ARCH="$(DEPLOY_ARCH)" DEPLOY_PKG="$(DEPLOY_PKG)" \
		DEPLOY_SSH_OPTS="$(DEPLOY_SSH_OPTS)" VERSION="$(VERSION)" \
		PACKAGE_BUILD="$(PACKAGE_BUILD)" PACKAGE_CLEAN="$(PACKAGE_CLEAN)"

deploy-package:
	@host="$(DEPLOY_HOST)"; \
	if [ -z "$$host" ] && [ -n "$(REMOTE_HOST)" ]; then \
		host="$(REMOTE_USER)@$(REMOTE_HOST)"; \
	fi; \
	if [ -z "$$host" ]; then \
		echo "DEPLOY_HOST is required. Usage: make deploy DEPLOY_HOST=user@host VERSION=0.1.0"; \
		exit 1; \
	fi; \
	chmod +x build/deploy-remote.sh; \
	DEPLOY_HOST="$$host" DEPLOY_ARCH="$(DEPLOY_ARCH)" DEPLOY_BIN="$(DEPLOY_BIN)" \
		DEPLOY_PKG="$(DEPLOY_PKG)" DEPLOY_SSH_OPTS="$(DEPLOY_SSH_OPTS)" VERSION="$(VERSION)" \
		PACKAGE_BUILD="$(PACKAGE_BUILD)" PACKAGE_CLEAN="$(PACKAGE_CLEAN)" \
		./build/deploy-remote.sh

deploy-remote: deploy-package

deploy-deb:
	chmod +x build/deploy-deb.sh
	DEPLOY_HOST="$(DEPLOY_HOST)" REMOTE_HOST="$(REMOTE_HOST)" REMOTE_USER="$(REMOTE_USER)" \
		VERSION="$(VERSION)" PACKAGE_NAME="$(PACKAGE_NAME)" \
		REMOTE_PATH="$(REMOTE_PATH)" PACKAGE_CLEAN="$(PACKAGE_CLEAN)" \
		PACKAGE_BUILD="$(PACKAGE_BUILD)" DEPLOY_ARCH="$(DEPLOY_ARCH)" \
		DEPLOY_SSH_OPTS="$(DEPLOY_SSH_OPTS)" \
		./build/deploy-deb.sh

deploy-rpm:
	chmod +x build/deploy-rpm.sh
	DEPLOY_HOST="$(DEPLOY_HOST)" REMOTE_HOST="$(REMOTE_HOST)" REMOTE_USER="$(REMOTE_USER)" \
		VERSION="$(VERSION)" PACKAGE_NAME="$(PACKAGE_NAME)" \
		REMOTE_PATH="$(REMOTE_PATH)" PACKAGE_CLEAN="$(PACKAGE_CLEAN)" \
		PACKAGE_BUILD="$(PACKAGE_BUILD)" DEPLOY_ARCH="$(DEPLOY_ARCH)" \
		DEPLOY_SSH_OPTS="$(DEPLOY_SSH_OPTS)" \
		./build/deploy-rpm.sh

deploy-rpm-arm64:
	@$(MAKE) deploy-rpm DEPLOY_HOST="$(DEPLOY_HOST)" REMOTE_HOST="$(REMOTE_HOST)" \
		REMOTE_USER="$(REMOTE_USER)" VERSION="$(VERSION)" \
		PACKAGE_NAME="$(PACKAGE_NAME)" REMOTE_PATH="$(REMOTE_PATH)" \
		PACKAGE_CLEAN="$(PACKAGE_CLEAN)" PACKAGE_BUILD="$(PACKAGE_BUILD)" \
		DEPLOY_ARCH=arm64 DEPLOY_SSH_OPTS="$(DEPLOY_SSH_OPTS)"

# --- Runner packaging & deploy ---
# make install-runner DEPLOY_HOST=user@host VERSION=0.1.0   (RPM / RHEL)
# make deploy-runner-deb DEPLOY_HOST=user@host VERSION=0.1.0 (DEB / Ubuntu)
# Or:  make deploy-runner-rpm DEPLOY_HOST=user@host

RUNNER_PACKAGE_NAME ?= pertisk-runner

package-runner-clean:
	rm -f pertisk-runner-linux-amd64 pertisk-runner-linux-arm64
	rm -f pertisk-runner-linux-amd64.version pertisk-runner-linux-arm64.version
	@echo "Removed runner Linux binaries; next package build will rebuild via Docker."

package-runner-amd64:
	chmod +x build/docker-common.sh build/package-runner.sh build/deb-rpm-runner.sh build/deploy-runner-rpm.sh build/deploy-runner-deb.sh
	PERTISK_FORCE_DOCKER_BUILD="$(PERTISK_FORCE_DOCKER_BUILD)" ./build/package-runner.sh amd64 $(VERSION) $(PACKAGE_TARGET)

package-runner-arm64:
	chmod +x build/docker-common.sh build/package-runner.sh build/deb-rpm-runner.sh build/deploy-runner-rpm.sh build/deploy-runner-deb.sh
	PERTISK_FORCE_DOCKER_BUILD="$(PERTISK_FORCE_DOCKER_BUILD)" ./build/package-runner.sh arm64 $(VERSION) $(PACKAGE_TARGET)

package-runner: package-runner-amd64 package-runner-arm64
	@echo "Done. See release/pertisk-runner-*"

install-runner: deploy-runner-rpm

deploy-runner-deb:
	chmod +x build/deploy-runner-deb.sh
	DEPLOY_HOST="$(DEPLOY_HOST)" REMOTE_HOST="$(REMOTE_HOST)" REMOTE_USER="$(REMOTE_USER)" \
		VERSION="$(VERSION)" PACKAGE_NAME="$(RUNNER_PACKAGE_NAME)" \
		REMOTE_PATH="$(REMOTE_PATH)" PACKAGE_CLEAN="$(PACKAGE_CLEAN)" \
		PACKAGE_BUILD="$(PACKAGE_BUILD)" DEPLOY_ARCH="$(DEPLOY_ARCH)" \
		DEPLOY_SSH_OPTS="$(DEPLOY_SSH_OPTS)" \
		./build/deploy-runner-deb.sh

deploy-runner-rpm:
	chmod +x build/deploy-runner-rpm.sh
	DEPLOY_HOST="$(DEPLOY_HOST)" REMOTE_HOST="$(REMOTE_HOST)" REMOTE_USER="$(REMOTE_USER)" \
		VERSION="$(VERSION)" PACKAGE_NAME="$(RUNNER_PACKAGE_NAME)" \
		REMOTE_PATH="$(REMOTE_PATH)" PACKAGE_CLEAN="$(PACKAGE_CLEAN)" \
		PACKAGE_BUILD="$(PACKAGE_BUILD)" DEPLOY_ARCH="$(DEPLOY_ARCH)" \
		DEPLOY_SSH_OPTS="$(DEPLOY_SSH_OPTS)" \
		./build/deploy-runner-rpm.sh

deploy-runner-rpm-arm64:
	@$(MAKE) deploy-runner-rpm DEPLOY_HOST="$(DEPLOY_HOST)" REMOTE_HOST="$(REMOTE_HOST)" \
		REMOTE_USER="$(REMOTE_USER)" VERSION="$(VERSION)" \
		REMOTE_PATH="$(REMOTE_PATH)" PACKAGE_CLEAN="$(PACKAGE_CLEAN)" \
		PACKAGE_BUILD="$(PACKAGE_BUILD)" DEPLOY_ARCH=arm64 DEPLOY_SSH_OPTS="$(DEPLOY_SSH_OPTS)"

# --- Runner Docker image & Compose ---
RUNNER_REGISTRY ?= harbor.homelab.pertisk.com/pertisksoft/pertisk-proxy
RUNNER_IMAGE_NAME ?= runner
RUNNER_IMAGE ?= $(RUNNER_REGISTRY)/$(RUNNER_IMAGE_NAME)
RUNNER_IMAGE_TAG ?= $(VERSION)
RUNNER_BUILDER ?= pertisk-runner-image
COMPOSE_RUNNER = docker compose -f deploy/docker-compose.runner.yml --env-file deploy/.env.runner

runner-image:
	@echo "Building $(RUNNER_IMAGE):$(RUNNER_IMAGE_TAG) (linux/amd64, local)..."
	export DOCKER_BUILDKIT=1; \
	docker buildx build --platform linux/amd64 \
	  -f docker/Dockerfile.runner.release \
	  --target runtime \
	  --build-arg VERSION="$(VERSION)" \
	  -t "$(RUNNER_IMAGE):$(RUNNER_IMAGE_TAG)" \
	  -t "$(RUNNER_IMAGE):latest" \
	  --load .

runner-image-push:
	@echo "Pushing $(RUNNER_IMAGE):$(RUNNER_IMAGE_TAG) to $(RUNNER_REGISTRY) (linux/amd64)..."
	@echo "Login first if needed: docker login $(RUNNER_REGISTRY)"
	$(MAKE) _runner-image-push-one PLATFORM=linux/amd64 SUFFIX=amd64 VERSION="$(VERSION)" TAG="$(RUNNER_IMAGE_TAG)"

runner-image-arm64:
	@echo "Pushing $(RUNNER_IMAGE):$(RUNNER_IMAGE_TAG)-arm64 to $(RUNNER_REGISTRY) (linux/arm64)..."
	@echo "Login first if needed: docker login $(RUNNER_REGISTRY)"
	$(MAKE) _runner-image-push-one PLATFORM=linux/arm64 SUFFIX=arm64 VERSION="$(VERSION)" TAG="$(RUNNER_IMAGE_TAG)-arm64"

_runner-image-push-one:
	@test -n "$(PLATFORM)" && test -n "$(SUFFIX)" && test -n "$(VERSION)" && test -n "$(TAG)"
	@ARCH=$$(echo "$(PLATFORM)" | cut -d/ -f2); \
	HOST_RAW=$$(uname -m); \
	case "$$HOST_RAW" in \
	  x86_64) HOST_ARCH=amd64 ;; \
	  aarch64|arm64) HOST_ARCH=arm64 ;; \
	  *) HOST_ARCH=amd64 ;; \
	esac; \
	export DOCKER_BUILDKIT=1; \
	if ! docker buildx inspect "$(RUNNER_BUILDER)" --bootstrap >/dev/null 2>&1; then \
	  docker buildx create --name "$(RUNNER_BUILDER)" --driver docker-container --bootstrap; \
	fi; \
	echo "Building $(RUNNER_IMAGE):$(TAG) platform=$(PLATFORM) host=$$HOST_ARCH target=$$ARCH jobs=$(CARGO_BUILD_JOBS)"; \
	docker buildx build --builder "$(RUNNER_BUILDER)" \
	  --platform "$(PLATFORM)" \
	  -f docker/Dockerfile.runner.release \
	  --target runtime \
	  --build-arg VERSION="$(VERSION)" \
	  --build-arg TARGETPLATFORM="$(PLATFORM)" \
	  --build-arg TARGETARCH="$$ARCH" \
	  --build-arg BUILDPLATFORM="linux/$$HOST_ARCH" \
	  --build-arg BUILDARCH="$$HOST_ARCH" \
	  --build-arg CARGO_BUILD_JOBS="$(CARGO_BUILD_JOBS)" \
	  -t "$(RUNNER_IMAGE):$(TAG)" \
	  $(if $(NO_CACHE),--no-cache,) \
	  --provenance=false \
	  --push .

runner-image-multi:
	@echo "Pushing $(RUNNER_IMAGE):$(RUNNER_IMAGE_TAG) (amd64 + arm64, separate builds) to $(RUNNER_REGISTRY)..."
	@echo "Login first if needed: docker login $(RUNNER_REGISTRY)"
	$(MAKE) _runner-image-push-one PLATFORM=linux/amd64 SUFFIX=amd64 VERSION="$(VERSION)" TAG="$(VERSION)-amd64" NO_CACHE="$(NO_CACHE)"
	$(MAKE) _runner-image-push-one PLATFORM=linux/arm64 SUFFIX=arm64 VERSION="$(VERSION)" TAG="$(VERSION)-arm64" NO_CACHE="$(NO_CACHE)"
	docker buildx imagetools create \
	  -t "$(RUNNER_IMAGE):$(RUNNER_IMAGE_TAG)" \
	  -t "$(RUNNER_IMAGE):latest" \
	  "$(RUNNER_IMAGE):$(VERSION)-amd64" \
	  "$(RUNNER_IMAGE):$(VERSION)-arm64"
	@echo "Verify: docker buildx imagetools inspect $(RUNNER_IMAGE):$(RUNNER_IMAGE_TAG)"

# --- Platform (pertisk-gits) Docker image ---
GITS_REGISTRY ?= harbor.homelab.pertisk.com/pertisksoft/pertisk-proxy
GITS_IMAGE_NAME ?= pertisk-gits
GITS_IMAGE ?= $(GITS_REGISTRY)/$(GITS_IMAGE_NAME)
GITS_IMAGE_TAG ?= $(VERSION)
GITS_IMAGE_BUILDER ?= pertisk-gits-image

pertisk-gits-image: web-dist
	@echo "Building $(GITS_IMAGE):$(GITS_IMAGE_TAG) (linux/amd64, local)..."
	export DOCKER_BUILDKIT=1; \
	docker buildx build --platform linux/amd64 \
	  -f docker/Dockerfile.gits.release \
	  --target runtime \
	  --build-arg VERSION="$(VERSION)" \
	  -t "$(GITS_IMAGE):$(GITS_IMAGE_TAG)" \
	  -t "$(GITS_IMAGE):latest" \
	  --load .

pertisk-gits-image-push: web-dist
	@echo "Pushing $(GITS_IMAGE):$(GITS_IMAGE_TAG) to $(GITS_REGISTRY) (linux/amd64)..."
	@echo "Login first if needed: docker login $(GITS_REGISTRY)"
	$(MAKE) _pertisk-gits-image-push-one PLATFORM=linux/amd64 SUFFIX=amd64 VERSION="$(VERSION)" TAG="$(GITS_IMAGE_TAG)"

pertisk-gits-image-arm64: web-dist
	@echo "Pushing $(GITS_IMAGE):$(GITS_IMAGE_TAG)-arm64 to $(GITS_REGISTRY) (linux/arm64)..."
	@echo "Login first if needed: docker login $(GITS_REGISTRY)"
	$(MAKE) _pertisk-gits-image-push-one PLATFORM=linux/arm64 SUFFIX=arm64 VERSION="$(VERSION)" TAG="$(GITS_IMAGE_TAG)-arm64"

_pertisk-gits-image-push-one:
	@test -n "$(PLATFORM)" && test -n "$(SUFFIX)" && test -n "$(VERSION)" && test -n "$(TAG)"
	@ARCH=$$(echo "$(PLATFORM)" | cut -d/ -f2); \
	HOST_RAW=$$(uname -m); \
	case "$$HOST_RAW" in \
	  x86_64) HOST_ARCH=amd64 ;; \
	  aarch64|arm64) HOST_ARCH=arm64 ;; \
	  *) HOST_ARCH=amd64 ;; \
	esac; \
	export DOCKER_BUILDKIT=1; \
	if ! docker buildx inspect "$(GITS_IMAGE_BUILDER)" --bootstrap >/dev/null 2>&1; then \
	  docker buildx create --name "$(GITS_IMAGE_BUILDER)" --driver docker-container --bootstrap; \
	fi; \
	echo "Building $(GITS_IMAGE):$(TAG) platform=$(PLATFORM) host=$$HOST_ARCH target=$$ARCH jobs=$(CARGO_BUILD_JOBS)"; \
	docker buildx build --builder "$(GITS_IMAGE_BUILDER)" \
	  --platform "$(PLATFORM)" \
	  -f docker/Dockerfile.gits.release \
	  --target runtime \
	  --build-arg VERSION="$(VERSION)" \
	  --build-arg TARGETPLATFORM="$(PLATFORM)" \
	  --build-arg TARGETARCH="$$ARCH" \
	  --build-arg BUILDPLATFORM="linux/$$HOST_ARCH" \
	  --build-arg BUILDARCH="$$HOST_ARCH" \
	  --build-arg CARGO_BUILD_JOBS="$(CARGO_BUILD_JOBS)" \
	  -t "$(GITS_IMAGE):$(TAG)" \
	  $(if $(NO_CACHE),--no-cache,) \
	  --provenance=false \
	  --push .

pertisk-gits-image-multi: web-dist
	@echo "Pushing $(GITS_IMAGE):$(GITS_IMAGE_TAG) (amd64 + arm64, separate builds) to $(GITS_REGISTRY)..."
	@echo "Login first if needed: docker login $(GITS_REGISTRY)"
	$(MAKE) _pertisk-gits-image-push-one PLATFORM=linux/amd64 SUFFIX=amd64 VERSION="$(VERSION)" TAG="$(VERSION)-amd64" NO_CACHE="$(NO_CACHE)"
	$(MAKE) _pertisk-gits-image-push-one PLATFORM=linux/arm64 SUFFIX=arm64 VERSION="$(VERSION)" TAG="$(VERSION)-arm64" NO_CACHE="$(NO_CACHE)"
	docker buildx imagetools create \
	  -t "$(GITS_IMAGE):$(GITS_IMAGE_TAG)" \
	  -t "$(GITS_IMAGE):latest" \
	  "$(GITS_IMAGE):$(VERSION)-amd64" \
	  "$(GITS_IMAGE):$(VERSION)-arm64"
	@echo "Verify: docker buildx imagetools inspect $(GITS_IMAGE):$(GITS_IMAGE_TAG)"

runner-compose-up:
	@test -f deploy/.env.runner || (echo "Copy deploy/.env.runner.example to deploy/.env.runner first" && exit 1)
	$(COMPOSE_RUNNER) up -d

runner-compose-down:
	$(COMPOSE_RUNNER) down

# --- Runner Helm chart ---
HELM_RUNNER_CHART = deploy/helm/pertisk-runner
HELM_RUNNER_RELEASE ?= pertisk-runner
HELM_RUNNER_NAMESPACE ?= pertisk

helm-runner-lint:
	helm lint $(HELM_RUNNER_CHART)

helm-runner-template:
	helm template $(HELM_RUNNER_RELEASE) $(HELM_RUNNER_CHART) \
	  --set apiUrl=https://git.example.com \
	  --set runnerToken=ptr_example

helm-runner-install:
	@test -n "$(RUNNER_TOKEN)" || (echo "Set RUNNER_TOKEN=ptr_..." && exit 1)
	helm upgrade --install $(HELM_RUNNER_RELEASE) $(HELM_RUNNER_CHART) \
	  --namespace $(HELM_RUNNER_NAMESPACE) --create-namespace \
	  --set apiUrl="$(PERTISK_API_URL)" \
	  --set runnerToken="$(RUNNER_TOKEN)" \
	  --set image.tag="$(VERSION)"

# Upgrade image tag only (multi-arch: linux/amd64 + linux/arm64). Run runner-image-multi first.
helm-runner-upgrade:
	helm upgrade $(HELM_RUNNER_RELEASE) $(HELM_RUNNER_CHART) \
	  --namespace $(HELM_RUNNER_NAMESPACE) \
	  --reuse-values \
	  --set image.tag="$(VERSION)" \
	  --set image.pullPolicy=Always

HELM_GITS_CHART = deploy/helm/pertisk-gits
HELM_GITS_RELEASE ?= pertisk-gits

helm-gits-lint:
	helm lint $(HELM_GITS_CHART)

helm-gits-template:
	helm template $(HELM_GITS_RELEASE) $(HELM_GITS_CHART) \
	  --set publicUrl=https://git.example.com \
	  --set jwt.secret=dev-secret \
	  --set database.url='postgres://pertisk:pertisk@postgres:5432/pertisk_gits'

# --- pertisk-gits on the omni-proxmox Talos cluster ---
# Requires the pertisk-gits-secret (database-url, jwt-secret, secrets-encryption-key)
# in the pertisk-proxy namespace. See deploy/helm/pertisk-gits/values-talos.yaml.
HELM_GITS_TALOS_NAMESPACE ?= pertisk-proxy
HELM_GITS_TALOS_VALUES = $(HELM_GITS_CHART)/values-talos.yaml
KUBECONFIG_TALOS ?= /Users/nat/.kube/omni-proxmox-285h-kubeconfig.yaml

helm-gits-talos-template:
	helm template $(HELM_GITS_RELEASE) $(HELM_GITS_CHART) \
	  -f $(HELM_GITS_TALOS_VALUES) \
	  --set image.tag="$(VERSION)"

helm-gits-talos-install:
	helm upgrade --install $(HELM_GITS_RELEASE) $(HELM_GITS_CHART) \
	  --namespace $(HELM_GITS_TALOS_NAMESPACE) --create-namespace \
	  -f $(HELM_GITS_TALOS_VALUES) \
	  --set image.tag="$(VERSION)" \
	  --kubeconfig $(KUBECONFIG_TALOS)

# Delete a tag (local and remote).
delete-tag:
ifndef TAG
	$(error TAG is not set. Usage: make delete-tag TAG=v1.0.0)
endif
	@echo "Deleting tag $(TAG)..."
	git tag -d $(TAG)
	git push origin -d $(TAG)

# Create a new tag.
create-tag:
ifndef TAG
	$(error TAG is not set. Usage: make create-tag TAG=v1.0.0)
endif
	@echo "Creating tag $(TAG)..."
	git tag $(TAG)
	git push origin $(TAG)

# Delete and recreate a tag (force update). Use after amending a release commit.
# Usage: make retag TAG=v1.0.0
retag:
ifndef TAG
	$(error TAG is not set. Usage: make retag TAG=v1.0.0)
endif
	@echo "Recreating tag $(TAG)..."
	@echo "Deleting local tag (if exists)..."
	-git tag -d $(TAG) 2>/dev/null || true
	@echo "Deleting remote tag (if exists)..."
	-git push origin -d $(TAG) 2>/dev/null || true
	@echo "Creating new tag $(TAG)..."
	git tag $(TAG)
	@echo "Pushing tag $(TAG) to origin..."
	git push origin $(TAG)
	@echo "✓ Tag $(TAG) created and pushed successfully"

clean-tag: retag