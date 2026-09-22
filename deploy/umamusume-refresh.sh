#!/usr/bin/env bash
# Scheduled data refresh + deploy for the Uma Musume Live Wiki.
#
# Production serves a read-only checkout with `server.js --no-crawl`
# (deploy/umamusume.service), so it never refreshes data on its own. This job
# keeps that data fresh without putting crawlers back into the web process:
#
#   1. refresh sources in a writable maintenance worktree
#   2. commit + push the tracked data changes
#   3. fast-forward the production checkout and restart the service
#
# Run it from deploy/umamusume-refresh.timer (see README) or by hand.
# Configuration is via environment variables, all with sensible defaults.
set -euo pipefail

BRANCH="${BRANCH:-main}"
PROD_DIR="${PROD_DIR:-/var/www/umamusume}"
MAINT_DIR="${MAINT_DIR:-/var/www/umamusume-maintenance}"
SERVICE="${SERVICE:-umamusume.service}"
NODE_BIN="${NODE_BIN:-node}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
RESTART_CMD="${RESTART_CMD:-sudo systemctl restart ${SERVICE}}"
DEPLOY="${DEPLOY:-1}"

log() { printf '[umamusume-refresh] %s\n' "$*"; }

command -v git >/dev/null 2>&1 || { log 'git not found'; exit 1; }
command -v "$NODE_BIN" >/dev/null 2>&1 || { log "node not found: $NODE_BIN"; exit 1; }

# 1) Make sure the maintenance worktree exists. It is a normal clone of the same
#    remote as production, but writable, so crawlers can update data files.
if [[ ! -d "$MAINT_DIR/.git" ]]; then
  remote="$(git -C "$PROD_DIR" remote get-url origin)"
  log "creating maintenance worktree at $MAINT_DIR from $remote"
  git clone --branch "$BRANCH" "$remote" "$MAINT_DIR"
fi

# 2) Refresh sources in the maintenance worktree.
cd "$MAINT_DIR"
git fetch --prune origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

log 'running one-shot refresh (news + catalog + Lantis)'
PYTHON_BIN="$PYTHON_BIN" "$NODE_BIN" uma_tools/server.js --refresh-once \
  || log 'refresh-once exited non-zero; continuing with whatever changed'

# 3) Commit + push tracked changes. Runtime caches that are gitignored
#    (e.g. lantis_news.json) are copied to production in step 4 instead.
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git -c user.name="${GIT_AUTHOR_NAME:-umamusume-refresh}" \
      -c user.email="${GIT_AUTHOR_EMAIL:-umamusume-refresh@localhost}" \
      commit -m "chore(data): scheduled refresh $(date -u +%Y-%m-%dT%H:%MZ)"
  git push origin "$BRANCH"
  log 'pushed scheduled data refresh'
else
  log 'no data changes to commit'
fi

# 4) Deploy to production and restart the web service.
if [[ "$DEPLOY" == "1" ]]; then
  if [[ -f "$MAINT_DIR/uma_tools/lantis_news.json" && -d "$PROD_DIR/uma_tools" ]]; then
    install -m 0644 "$MAINT_DIR/uma_tools/lantis_news.json" "$PROD_DIR/uma_tools/lantis_news.json" || true
  fi
  cd "$PROD_DIR"
  git fetch --prune origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
  log "restarting $SERVICE"
  eval "$RESTART_CMD"
fi

log 'done'
