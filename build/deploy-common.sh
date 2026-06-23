# Shared deploy host parsing for build/deploy-*.sh
# DEPLOY_HOST=user@host overrides REMOTE_USER + REMOTE_HOST when set.

resolve_deploy_host() {
  if [ -n "${DEPLOY_HOST:-}" ]; then
    if [[ "$DEPLOY_HOST" != *@* ]]; then
      echo "DEPLOY_HOST must be user@host (got: $DEPLOY_HOST)" >&2
      return 1
    fi
    REMOTE_USER="${DEPLOY_HOST%%@*}"
    REMOTE_HOST="${DEPLOY_HOST#*@}"
    export REMOTE_USER REMOTE_HOST
  fi
}
