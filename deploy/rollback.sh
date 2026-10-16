#!/usr/bin/env bash
# Restore the previous code release while preserving the current live dataset.
set -euo pipefail
ROOT=/var/www/umamusume
exec 9>"$ROOT/.deploy.lock"
flock 9
WORK="$(mktemp -d)"
SWITCHED=0
trap 'rm -rf "$WORK"' EXIT
CURRENT="$(readlink -f "$ROOT/current")"
cp "$ROOT/shared/deployment.json" "$WORK/original-state.json"
cp "$ROOT/deploy/nginx-uma-live-wiki.conf" "$WORK/original-nginx.conf"
node - "$WORK/original-state.json" "$WORK/target-state.json" <<'NODE'
const fs=require('fs'), state=JSON.parse(fs.readFileSync(process.argv[2]));
if (!state.previous) throw new Error('No previous release is available');
const active={...state.previous,service:'umamusume@'+state.previous.port+'.service'};
fs.writeFileSync(process.argv[3],JSON.stringify({active,previous:state.active}));
NODE
RELEASE="$(node -p 'require(process.argv[1]).active.release' "$WORK/target-state.json")"
PORT="$(node -p 'require(process.argv[1]).active.port' "$WORK/target-state.json")"
SHA="$(node -p 'require(process.argv[1]).active.commit' "$WORK/target-state.json")"
[[ "$RELEASE" =~ ^/var/www/umamusume/releases/[a-f0-9]{40}$ ]] || exit 1
[[ "$PORT" =~ ^808[01]$ ]] || exit 1
SERVICE="umamusume@$PORT.service"
TARGET_DATA="$(readlink -f "$RELEASE/data")"
exec 8>"$ROOT/shared/data/auto_update/.lock"
flock -w 21600 8
recover() {
  ln -sfn "$TARGET_DATA" "$RELEASE/data"
  if [ "$SWITCHED" = 1 ]; then
    node "$ROOT/deploy/deployment-state.js" restore "$ROOT" "$WORK/original-state.json"
    cp "$WORK/original-nginx.conf" "$ROOT/deploy/nginx-uma-live-wiki.conf"
    nginx -t && systemctl reload nginx
  fi
}
trap recover ERR
trap 'recover; exit 1' INT TERM
ln -sfn "$(readlink -f "$ROOT/shared/data")" "$RELEASE/data"
if systemctl is-active --quiet umamusume.service && [ "$PORT" = 8080 ]; then systemctl stop umamusume.service; fi
ln -sfn "$RELEASE" "$ROOT/slots/$PORT"
systemctl start "$SERVICE"
for attempt in {1..30}; do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/release" >/dev/null; then break; fi
  sleep 1
done
node "$ROOT/deploy/check_deployment.js" "http://127.0.0.1:$PORT" "$SHA"
sed -e "s|root /var/www/umamusume/current;|root $RELEASE;|" -e "s|127.0.0.1:8080|127.0.0.1:$PORT|" "$ROOT/deploy/nginx-template.conf" > "$ROOT/deploy/nginx-uma-live-wiki.conf.next"
mv -f "$ROOT/deploy/nginx-uma-live-wiki.conf.next" "$ROOT/deploy/nginx-uma-live-wiki.conf"
SWITCHED=1
nginx -t
node "$ROOT/deploy/deployment-state.js" restore "$ROOT" "$WORK/target-state.json"
systemctl reload nginx
node "$ROOT/deploy/check_deployment.js" "${UMA_PUBLIC_URL:-https://umamusumelivewiki.top}" "$SHA"
systemctl enable "$SERVICE"
OLD_SERVICE="$(node -p 'require(process.argv[1]).active.service' "$WORK/original-state.json")"
systemctl disable "$OLD_SERVICE" 2>/dev/null || true
systemd-run --unit="uma-rollback-drain-$(date +%s)" --on-active=30m /bin/bash "$ROOT/deploy/drain-release.sh" "$CURRENT" "$OLD_SERVICE"
SWITCHED=0
echo "Restored code $SHA; current source data, news archive and translations retained. The daily timer can publish main again."
