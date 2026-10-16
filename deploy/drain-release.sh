#!/usr/bin/env bash
# Retire an inactive process after its existing streams have had time to finish.
set -euo pipefail
ROOT=/var/www/umamusume
RELEASE="$1"
SERVICE="$2"
[[ "$RELEASE" =~ ^/var/www/umamusume/releases/[a-f0-9]{40}$ ]] || exit 1
[[ "$SERVICE" =~ ^umamusume(@808[01])?\.service$ ]] || exit 1
exec 9>"$ROOT/.deploy.lock"
flock 9
ACTIVE="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).active.service' "$ROOT/shared/deployment.json")"
[ "$ACTIVE" != "$SERVICE" ] || exit 0
systemctl stop "$SERVICE"
node "$ROOT/deploy/deployment-state.js" merge-legacy-news "$ROOT" "$RELEASE"
