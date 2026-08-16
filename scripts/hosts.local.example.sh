#!/usr/bin/env bash
# Copy to hosts.local.sh and fill in real values. hosts.local.sh is gitignored.
#
#   cp scripts/hosts.local.example.sh scripts/hosts.local.sh

# --- Package deploy (scripts/deploy.sh, deploy-cloud.sh, deploy-arm.sh) ---
# Space-separated or bash arrays of user@host targets.
DEPLOY_GITS_HOSTS=(
  # user@host
)
DEPLOY_RUNNER_HOSTS=(
  # user@host
)
DEPLOY_ARM_GITS_HOSTS=(
  # user@host
)
DEPLOY_ARM_RUNNER_HOSTS=(
  # user@host
)
DEPLOY_CLOUD_GITS_HOSTS=(
  # user@host
)
DEPLOY_CLOUD_RUNNER_HOSTS=(
  # user@host
)

# Optional: after deploy, run docker prune (0=off, 1=prune unused, all=prune -a)
# DOCKER_PRUNE=0

# --- Container registry (override Makefile defaults) ---
# export RUNNER_REGISTRY=ghcr.io/example/pertisk
# export GITS_REGISTRY=ghcr.io/example/pertisk

# --- Helm / K8s deploy (scripts/deploy-gits.sh, deploy-runner.sh) ---
# GITS_IMAGE=ghcr.io/example/pertisk/pertisk-gits
# RUNNER_IMAGE=ghcr.io/example/pertisk/runner
# GITS_HELM_VALUES=deploy/helm/pertisk-gits/values.cluster.example.yaml
# RUNNER_HELM_VALUES=deploy/helm/pertisk-runner/values-kubernetes.yaml
# HELM_NAMESPACE=pertisk-gits
# API_URL=https://git.example.com
# RUNNER_TOKEN=ptr_change_me
