#!/usr/bin/env bash
# Publish one committed release; retain live data and the previous code release.
set -euo pipefail
ROOT="${1:-/var/www/umamusume}"
ARCHIVE="${2:-}"
UMA_USER="${UMA_USER:-alaemiryoung}"
[ "$ROOT" = /var/www/umamusume ] && [ "$UMA_USER" = alaemiryoung ] || {
  echo 'Update systemd/nginx paths before changing the deployment directory.'; exit 1;
}
mkdir -p "$ROOT/releases" "$ROOT/shared"
exec 9>"$ROOT/.deploy.lock"
flock 9
WORK="$(mktemp -d)"
OLD="$(readlink "$ROOT/current" || true)"
ACTIVATED=0
MIGRATED=0
PROBE_PID=""
cleanup() { if [ -n "$PROBE_PID" ]; then kill "$PROBE_PID" 2>/dev/null || true; fi; rm -rf "$WORK"; }
trap cleanup EXIT
recover() {
  if [ "$ACTIVATED" = 1 ]; then
    if [ -n "$OLD" ]; then
      ln -s "$OLD" "$ROOT/current.rollback"
      mv -Tf "$ROOT/current.rollback" "$ROOT/current"
    elif [ -L "$ROOT/current" ]; then
      unlink "$ROOT/current"
    fi
    cp "$WORK/previous-nginx.conf" "$ROOT/deploy/nginx-uma-live-wiki.conf"
    cp "$WORK/previous-service" /etc/systemd/system/umamusume.service
    systemctl daemon-reload
    nginx -t && systemctl reload nginx
    systemctl restart umamusume.service
    echo 'Verification failed; previous code/configuration restored. Live data unchanged.'
  elif [ "$MIGRATED" = 1 ]; then
    systemctl start umamusume.service
  fi
}
trap recover ERR
fetch() { curl -fsSL --connect-timeout 15 --max-time 180 "$@"; }

if [ -n "$ARCHIVE" ]; then
  [ -f "$ARCHIVE" ] || { echo 'Release archive not found'; exit 1; }
  tar -xzf "$ARCHIVE" -C "$WORK"
  SRC="$WORK"
else
  SHA="$(fetch https://api.github.com/repos/516735955/uma-live-wiki/commits/main | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).sha))')"
  [[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo 'Cannot resolve main commit'; exit 1; }
  fetch "https://codeload.github.com/516735955/uma-live-wiki/tar.gz/$SHA" -o "$WORK/source.tgz"
  mkdir "$WORK/source"
  tar -xzf "$WORK/source.tgz" -C "$WORK/source" --strip-components=1
  SRC="$WORK/source"
  fetch "https://api.github.com/repos/516735955/uma-live-wiki/commits?sha=$SHA&per_page=100" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).map(x=>x.sha).join("\n")))' > "$WORK/ancestors"
  node "$SRC/deploy/prepare-release.js" "$SRC" "$SHA" "$WORK/ancestors"
fi
[ -f "$SRC/release.json" ] || { echo 'Use: node deploy/package-release.js HEAD /tmp/uma-release.tgz'; exit 1; }
SHA="$(node -p 'require(process.argv[1]).commit' "$SRC/release.json")"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid release commit'; exit 1; }
if [ -n "$OLD" ]; then
  node - "$SRC/release.json" "$ROOT/current/release.json" <<'NODE'
const incoming = require(process.argv[2]), running = require(process.argv[3]);
if (incoming.commit !== running.commit && !incoming.ancestors.includes(running.commit)) {
  console.error('Refusing an older or unrelated deployment: ' + incoming.commit); process.exit(1);
}
NODE
fi
RELEASE="$ROOT/releases/$SHA"
if [ ! -d "$RELEASE" ]; then
  RELEASE="$ROOT/releases/.preparing-$SHA"
  if [ -d "$RELEASE" ]; then rm -rf "$RELEASE"; fi
  cp -a "$SRC" "$RELEASE"
  # A stopped service cannot write into the legacy data tree during migration.
  if [ ! -d "$ROOT/shared/data" ]; then
    systemctl stop umamusume.service
    MIGRATED=1
    if [ -d "$ROOT/data" ]; then mv "$ROOT/data" "$ROOT/shared/data"; ln -s shared/data "$ROOT/data";
    else cp -a "$SRC/data" "$ROOT/shared/data"; fi
  fi
  for name in trans_cache.json baidu.conf.json; do
    if [ ! -f "$ROOT/shared/$name" ]; then
      if [ -f "$ROOT/uma_tools/$name" ]; then cp -a "$ROOT/uma_tools/$name" "$ROOT/shared/$name";
      elif [ -f "$SRC/uma_tools/$name" ]; then cp -a "$SRC/uma_tools/$name" "$ROOT/shared/$name"; fi
    fi
    if [ -f "$ROOT/shared/$name" ]; then
      rm -f "$RELEASE/uma_tools/$name"
      ln -s "$ROOT/shared/$name" "$RELEASE/uma_tools/$name"
    fi
  done
  rm -rf "$RELEASE/data"
  ln -s "$ROOT/shared/data" "$RELEASE/data"
  for name in album_covers uma_avatars uma_moe uma_official uma_va video_thumbs uma_tools/img; do
    shared="$ROOT/shared/$name"
    mkdir -p "$(dirname "$shared")"
    if [ ! -d "$shared" ] && [ -d "$ROOT/$name" ]; then
      mv "$ROOT/$name" "$shared"
      ln -s "$shared" "$ROOT/$name"
    fi
    mkdir -p "$shared"
    if [ -d "$RELEASE/$name" ]; then cp -an "$RELEASE/$name/." "$shared/"; rm -rf "$RELEASE/$name"; fi
    mkdir -p "$(dirname "$RELEASE/$name")"
    ln -s "$shared" "$RELEASE/$name"
  done
  mkdir -p "$ROOT/shared/assets"
  cp -a "$RELEASE/assets/." "$ROOT/shared/assets/"
  rm -rf "$RELEASE/assets"
  ln -s "$ROOT/shared/assets" "$RELEASE/assets"
  mv "$RELEASE" "$ROOT/releases/$SHA"
  RELEASE="$ROOT/releases/$SHA"
fi
chown -R "$UMA_USER:$UMA_USER" "$RELEASE" "$ROOT/shared"
chmod 0755 "$RELEASE"
find "$ROOT/shared/data" -type d -exec chmod 0755 {} +
find "$ROOT/shared/data" -type f \( -name '*.json' -o -name '*.js' \) -exec chmod 0644 {} +
node --check "$RELEASE/uma_tools/server.js"
if ! python3 -c 'import PIL' >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then apt-get update; apt-get install -y python3-pil;
  else python3 -m pip install Pillow; fi
fi
# Exercise the complete candidate against live data before switching nginx.
runuser -u "$UMA_USER" -- node "$RELEASE/uma_tools/server.js" 8081 "$RELEASE" --no-crawl > "$WORK/probe.log" 2>&1 &
PROBE_PID=$!
for attempt in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:8081/api/release >/dev/null; then break; fi
  sleep 1
done
node "$RELEASE/uma_tools/check_deployment.js" http://127.0.0.1:8081 "$SHA"
kill "$PROBE_PID"
wait "$PROBE_PID" 2>/dev/null || true
PROBE_PID=""
cp "$ROOT/deploy/nginx-uma-live-wiki.conf" "$WORK/previous-nginx.conf"
cp /etc/systemd/system/umamusume.service "$WORK/previous-service"
ACTIVATED=1
cp "$RELEASE/deploy/nginx-uma-live-wiki.conf" "$ROOT/deploy/nginx-uma-live-wiki.conf"
install -m 0644 "$RELEASE/deploy/umamusume.service" /etc/systemd/system/umamusume.service
install -m 0644 "$RELEASE/deploy/umamusume-restart.service" /etc/systemd/system/umamusume-restart.service
install -m 0644 "$RELEASE/deploy/umamusume-restart.timer" /etc/systemd/system/umamusume-restart.timer
ln -s "$RELEASE" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
systemctl daemon-reload
nginx -t
systemctl reload nginx
systemctl enable --now umamusume.service umamusume-restart.timer
systemctl restart umamusume.service
for attempt in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:8080/api/release >/dev/null; then break; fi
  sleep 1
done
node "$RELEASE/uma_tools/check_deployment.js" "${UMA_PUBLIC_URL:-https://umamusumelivewiki.top}" "$SHA"
systemctl is-active umamusume.service
ACTIVATED=0
node "$RELEASE/deploy/cleanup-releases.js" "$ROOT" "$SHA" "$OLD"
echo "Published $SHA; live data preserved."
