.PHONY: build build-local build-package check test run run-release \
	infra infra-down install-web web-dist web-dist-docker fix-perms \
	dev dev-vite dev-serve dev-web dev-stop \
	package package-clean package-amd64 package-arm64 package-deb package-rpm \
	package-runner package-runner-clean package-runner-amd64 package-runner-arm64 \
	release release-amd release-arm \
	deploy deploy-package deploy-remote deploy-deb deploy-rpm \
	install-runner deploy-runner-rpm

CARGO ?= cargo
COMPOSE ?= docker compose -f deploy/docker-compose.yml

VERSION ?= $(shell git describe --tags --always 2>/dev/null | sed 's/^v//' || echo "0.1.0")
PACKAGE_TARGET ?= all
BUILDER_NAME ?= pertisk-gits-package
CACHE_DIR ?= .buildx-cache/release

# Dev
DEV_API_PORT ?= 8080
DEV_USER ?= $(if $(SUDO_USER),$(SUDO_USER),$(USER))
RUN_AS_USER = $(if $(filter root,$(USER)),sudo -u $(DEV_USER) ,)

# Remote deploy — use DEPLOY_HOST=user@host (like pertisk-proxy) or REMOTE_USER + REMOTE_HOST
DEPLOY_HOST ?=
DEPLOY_ARCH ?= amd64
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

run:
	$(CARGO) run -p pertisk-api

run-release: web-dist
	$(CARGO) run --release -p pertisk-api

# --- Infrastructure (Postgres, Redis, MinIO) ---
infra:
	$(COMPOSE) up -d postgres

infra-down:
	$(COMPOSE) down

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

.PHONY: web-dist-docker
web-dist-docker:
	@echo "Building web UI via Docker (v$(VERSION))..."
	docker build -f docker/Dockerfile.web --build-arg VERSION="$(VERSION)" -t pertisk-web-dist .
	rm -rf web/dist && mkdir -p web/dist
	docker rm -f extract-web-dist 2>/dev/null || true
	docker create --name extract-web-dist pertisk-web-dist
	docker cp extract-web-dist:/web/dist/. web/dist/
	docker rm extract-web-dist
	@test -f web/dist/index.html

web-dist:
	@if [ -d web/dist/assets ] && [ ! -w web/dist/assets ]; then \
		echo "web/dist is not writable (usually from 'sudo make dev'). Run: sudo make fix-perms"; exit 1; \
	fi
	@echo "Checking web UI build cache (version $(VERSION))..."
	@skip=0; \
	if [ -d web/dist ] && [ -f "$(WEB_VERSION_FILE)" ] && [ "$$(cat $(WEB_VERSION_FILE))" = "$(VERSION)" ]; then \
		if [ -z "$$(find web/src web/public web/index.html web/package.json web/package-lock.json web/vite.config.ts -type f -newer web/dist 2>/dev/null | head -n 1)" ]; then \
			echo "web/dist is up to date (v$(VERSION)); skipping build."; \
			skip=1; \
		fi; \
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
				echo "Cannot clean web/dist. Run: sudo make fix-perms"; exit 1; \
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

# Single-port dev: Postgres + API serves web/dist (set WEB_DIST in .env).
dev: web-dist dev-stop infra
	chmod +x $(DEV_PREFIX)
	$(CARGO) watch -i web -x 'run -p pertisk-api' 2>&1 | $(DEV_PREFIX) api

# Hot-reload UI on :5173, API on DEV_API_PORT (Vite proxies /api/v1).
dev-vite: dev-stop infra
	chmod +x $(DEV_PREFIX)
	$(CARGO) watch -i web -x 'run -p pertisk-api' 2>&1 | $(DEV_PREFIX) api & \
	(cd web && $(RUN_AS_USER)npm run dev 2>&1 | $(DEV_PREFIX) vite) & \
	wait

dev-serve: dev

# --- Packaging: DEB + RPM + tarball (Docker cross-build on macOS) → release/ ---
# Requires: docker (buildx + fpm container on macOS).
# make package              — amd64 + arm64
# make package-amd64        — amd64 only

package-clean:
	rm -f pertisk-gits-linux-amd64 pertisk-gits-linux-arm64
	rm -f web/dist/.app-version
	@echo "Removed Linux binaries; next package build will rebuild via Docker."

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
# Or:      make deploy-deb DEPLOY_HOST=user@host
#          make deploy-rpm DEPLOY_HOST=user@host

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
		PACKAGE_BUILD="$(PACKAGE_BUILD)" DEB_ARCH="$(DEPLOY_ARCH)" \
		./build/deploy-deb.sh

deploy-rpm:
	chmod +x build/deploy-rpm.sh
	DEPLOY_HOST="$(DEPLOY_HOST)" REMOTE_HOST="$(REMOTE_HOST)" REMOTE_USER="$(REMOTE_USER)" \
		VERSION="$(VERSION)" PACKAGE_NAME="$(PACKAGE_NAME)" \
		REMOTE_PATH="$(REMOTE_PATH)" PACKAGE_CLEAN="$(PACKAGE_CLEAN)" \
		PACKAGE_BUILD="$(PACKAGE_BUILD)" RPM_ARCH="$(if $(filter arm64,$(DEPLOY_ARCH)),aarch64,x86_64)" \
		./build/deploy-rpm.sh

# --- Runner packaging & deploy ---
# make install-runner DEPLOY_HOST=user@host VERSION=0.1.0
# Or:  make deploy-runner-rpm DEPLOY_HOST=user@host

RUNNER_PACKAGE_NAME ?= pertisk-runner

package-runner-clean:
	rm -f pertisk-runner-linux-amd64 pertisk-runner-linux-arm64
	rm -f pertisk-runner-linux-amd64.version pertisk-runner-linux-arm64.version
	@echo "Removed runner Linux binaries; next package build will rebuild via Docker."

package-runner-amd64:
	chmod +x build/docker-common.sh build/package-runner.sh build/deb-rpm-runner.sh build/deploy-runner-rpm.sh
	PERTISK_FORCE_DOCKER_BUILD="$(PERTISK_FORCE_DOCKER_BUILD)" ./build/package-runner.sh amd64 $(VERSION) $(PACKAGE_TARGET)

package-runner-arm64:
	chmod +x build/docker-common.sh build/package-runner.sh build/deb-rpm-runner.sh build/deploy-runner-rpm.sh
	PERTISK_FORCE_DOCKER_BUILD="$(PERTISK_FORCE_DOCKER_BUILD)" ./build/package-runner.sh arm64 $(VERSION) $(PACKAGE_TARGET)

package-runner: package-runner-amd64 package-runner-arm64
	@echo "Done. See release/pertisk-runner-*"

install-runner: deploy-runner-rpm

deploy-runner-rpm:
	chmod +x build/deploy-runner-rpm.sh
	DEPLOY_HOST="$(DEPLOY_HOST)" REMOTE_HOST="$(REMOTE_HOST)" REMOTE_USER="$(REMOTE_USER)" \
		VERSION="$(VERSION)" PACKAGE_NAME="$(RUNNER_PACKAGE_NAME)" \
		REMOTE_PATH="$(REMOTE_PATH)" PACKAGE_CLEAN="$(PACKAGE_CLEAN)" \
		PACKAGE_BUILD="$(PACKAGE_BUILD)" RPM_ARCH="$(if $(filter arm64,$(DEPLOY_ARCH)),aarch64,x86_64)" \
		./build/deploy-runner-rpm.sh
