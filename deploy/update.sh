#!/usr/bin/env bash
# Prepare and verify a complete release while the old site keeps serving.
set -euo pipefail
ROOT="${1:-/var/www/umamusume}"
ARCHIVE="${2:-}"
PREVIOUS_ARCHIVE="${3:-}"
UMA_USER="${UMA_USER:-alaemiryoung}"
[ "$ROOT" = /var/www/umamusume ] && [ "$UMA_USER" = alaemiryoung ] || {
  echo 'Update systemd/nginx paths before changing the deployment directory.'; exit 1;
}
mkdir -p "$ROOT/releases" "$ROOT/shared" "$ROOT/slots" "$ROOT/deploy"
exec 9>"$ROOT/.deploy.lock"
flock 9
systemctl disable --now umamusume-restart.timer 2>/dev/null || true
WORK="$(mktemp -d)"
ACTIVATED=0
STARTED=0
COMPLETE=0
MEDIA_PUBLISHED=0
LEGACY_DROPIN=0
SERVICE=""
cleanup() {
  if [ "$COMPLETE" = 0 ] && [ "$STARTED" = 1 ]; then systemctl stop "$SERVICE" || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
recover() {
  if [ "$MEDIA_PUBLISHED" = 1 ] && [ -f "$WORK/media-backup/changes.json" ]; then
    node "$SRC/deploy/media-sync.js" rollback "$ROOT/shared" "$WORK/media-backup"
    chown -R "$UMA_USER:$UMA_USER" "$ROOT/shared"
  fi
  if [ "$ACTIVATED" = 1 ]; then
    node "$SRC/deploy/deployment-state.js" restore "$ROOT" "$WORK/previous-state.json"
    cp "$WORK/previous-nginx.conf" "$ROOT/deploy/nginx-uma-live-wiki.conf"
    nginx -t && systemctl reload nginx
    echo 'Candidate failed; previous site restored, shared news and translations retained.'
  fi
  if [ "$LEGACY_DROPIN" = 1 ]; then rm -f /run/systemd/system/umamusume.service.d/1016-drain.conf; systemctl daemon-reload; fi
}
trap recover ERR
trap 'recover; exit 1' INT TERM
fetch() { curl -fsSL --retry 2 --connect-timeout 15 --max-time 180 "$@"; }
fetch_file() {
  local url="$1" target="$2" attempt status
  for attempt in 1 2 3; do
    if curl -fsSL --connect-timeout 15 --max-time 180 --continue-at - "$url" -o "$target"; then return 0; else status=$?; fi
    if [ "$status" = 33 ]; then rm -f "$target"; fi
    [ "$attempt" = 3 ] || sleep 2
  done
  return 1
}
RUNNING="$(node -p 'require(process.argv[1]).commit' "$ROOT/current/release.json")"
if [ -n "$ARCHIVE" ]; then
  [ -f "$ARCHIVE" ] || { echo 'Release archive not found'; exit 1; }
  mkdir "$WORK/source"
  tar -xzf "$ARCHIVE" -C "$WORK/source"
  SRC="$WORK/source"
else
  SHA="$(fetch https://api.github.com/repos/516735955/uma-live-wiki/commits/main | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).sha))')"
  [[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo 'Cannot resolve main commit'; exit 1; }
  if [ "$SHA" = "$RUNNING" ]; then echo "Already serving latest main $SHA"; COMPLETE=1; exit 0; fi
  fetch_file "https://codeload.github.com/516735955/uma-live-wiki/tar.gz/$SHA" "$WORK/source.tgz"
  mkdir "$WORK/source"
  tar -xzf "$WORK/source.tgz" -C "$WORK/source" --strip-components=1
  SRC="$WORK/source"
  STATUS="$(fetch "https://api.github.com/repos/516735955/uma-live-wiki/compare/$RUNNING...$SHA" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).status))')"
  [ "$STATUS" = ahead ] || { echo 'Refusing an older or unrelated main commit'; exit 1; }
  printf '%s\n' "$RUNNING" > "$WORK/ancestors"
  npm ci --prefix "$SRC/uma_tools" --include=dev --no-audit --no-fund
  node "$SRC/deploy/prepare-release.js" "$SRC" "$SHA" "$WORK/ancestors"
  rm -rf "$SRC/uma_tools/node_modules"
fi
[ -f "$SRC/release.json" ] || { echo 'Use: node deploy/package-release.js HEAD /tmp/uma-release.tgz'; exit 1; }
SHA="$(node -p 'require(process.argv[1]).commit' "$SRC/release.json")"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid release commit'; exit 1; }
if [ "$SHA" = "$RUNNING" ]; then echo "Already serving $SHA"; COMPLETE=1; exit 0; fi
node - "$SRC/release.json" "$RUNNING" <<'NODE'
const incoming = require(process.argv[2]);
if (!incoming.ancestors.includes(process.argv[3])) {
  console.error('Refusing an older or unrelated archive'); process.exit(1);
}
NODE
OLD="$(readlink -f "$ROOT/current")"
if ! python3 -c 'import PIL, bs4, openpyxl' >/dev/null 2>&1 || ! command -v yt-dlp >/dev/null 2>&1 || ! command -v ffmpeg >/dev/null 2>&1 || ! command -v tesseract >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get update
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y --no-install-recommends python3-pil python3-bs4 python3-openpyxl yt-dlp ffmpeg tesseract-ocr tesseract-ocr-jpn
fi
timeout 15 yt-dlp --help > "$WORK/yt-dlp-help"
if ! grep -q -- '--js-runtimes' "$WORK/yt-dlp-help"; then
  fetch_file https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp "$WORK/yt-dlp"
  chmod 0755 "$WORK/yt-dlp"
  timeout 15 "$WORK/yt-dlp" --version
  install -m 0755 "$WORK/yt-dlp" /usr/local/bin/yt-dlp
fi
PREVIOUS_SOURCE="$WORK/previous-source"
mkdir "$PREVIOUS_SOURCE"
if [ -n "$PREVIOUS_ARCHIVE" ]; then
  tar -xzf "$PREVIOUS_ARCHIVE" -C "$PREVIOUS_SOURCE"
  [ "$(node -p 'require(process.argv[1]).commit' "$PREVIOUS_SOURCE/release.json")" = "$RUNNING" ] || { echo 'Previous source archive mismatch'; exit 1; }
else
  fetch_file "https://codeload.github.com/516735955/uma-live-wiki/tar.gz/$RUNNING" "$WORK/previous-source.tgz"
  tar -xzf "$WORK/previous-source.tgz" -C "$PREVIOUS_SOURCE" --strip-components=1
fi
echo 'Waiting for source updates; the old site remains available.'
mkdir -p "$ROOT/shared/data/auto_update"
exec 8>"$ROOT/shared/data/auto_update/.lock"
flock -w 21600 8 || { echo 'Source lock remains busy after six hours; current site retained.'; exit 1; }
node "$SRC/deploy/deployment-state.js" initialize "$ROOT" > "$WORK/previous-state.json"
PORT="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).active.port===8080?8081:8080' "$WORK/previous-state.json")"
OLD_SERVICE="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).active.service' "$WORK/previous-state.json")"
SERVICE="umamusume@$PORT.service"
systemctl stop "$SERVICE" 2>/dev/null || true
RELEASE="$ROOT/releases/$SHA"
[ ! -e "$RELEASE" ] || rm -rf "$RELEASE"
cp -a "$SRC" "$RELEASE"
GENERATION="$ROOT/shared/datasets/$SHA-$(date +%s)"
node "$SRC/deploy/data-sync.js" stage "$SRC/data" "$PREVIOUS_SOURCE/data" "$ROOT/shared/data" "$GENERATION"
node "$SRC/deploy/deployment-state.js" prepare-data "$ROOT" "$GENERATION"
rm -rf "$RELEASE/data"
ln -s "$GENERATION" "$RELEASE/data"
for name in trans_cache.json baidu.conf.json; do
  if [ ! -f "$ROOT/shared/$name" ]; then
    if [ -f "$OLD/uma_tools/$name" ]; then cp -aL "$OLD/uma_tools/$name" "$ROOT/shared/$name";
    elif [ -f "$SRC/uma_tools/$name" ]; then cp -a "$SRC/uma_tools/$name" "$ROOT/shared/$name"; fi
  fi
  if [ -f "$ROOT/shared/$name" ]; then rm -f "$RELEASE/uma_tools/$name"; ln -s "$ROOT/shared/$name" "$RELEASE/uma_tools/$name"; fi
done
for name in album_covers uma_avatars uma_moe uma_official uma_va video_thumbs uma_tools/img; do mkdir -p "$ROOT/shared/$name"; done
node "$SRC/deploy/media-sync.js" stage "$SRC" "$PREVIOUS_SOURCE" "$ROOT/shared" "$RELEASE"
python3 "$RELEASE/uma_tools/update_events.py"
python3 "$RELEASE/uma_tools/build_anime_catalog.py"
python3 "$RELEASE/uma_tools/build_pedigree.py"
mkdir -p "$ROOT/shared/assets" "$ROOT/shared/backups"
cp -a "$RELEASE/assets/." "$ROOT/shared/assets/"
rm -rf "$RELEASE/assets"
ln -s "$ROOT/shared/assets" "$RELEASE/assets"
if [ -f "$ROOT/shared/runtime/auto_update/news.sqlite" ]; then
  python3 "$RELEASE/uma_tools/archive_news.py" --database "$ROOT/shared/runtime/auto_update/news.sqlite" --backup "$ROOT/shared/backups/news-$(date +%Y%m%d-%H%M%S).sqlite"
fi
chown -R "$UMA_USER:$UMA_USER" "$RELEASE" "$GENERATION" "$ROOT/shared"
find "$GENERATION" -type d -exec chmod 0755 {} +
find "$GENERATION" -type f \( -name '*.json' -o -name '*.js' \) -exec chmod 0644 {} +
node --check "$RELEASE/uma_tools/server.js"
install -m 0644 "$RELEASE/deploy/umamusume@.service" /etc/systemd/system/umamusume@.service
if [ "$OLD_SERVICE" = umamusume.service ]; then
  mkdir -p /run/systemd/system/umamusume.service.d
  printf '[Service]\nRestart=no\n' > /run/systemd/system/umamusume.service.d/1016-drain.conf
  LEGACY_DROPIN=1
fi
ln -sfn "$RELEASE" "$ROOT/slots/$PORT"
systemctl daemon-reload
if [ "$PORT" = 8080 ] && systemctl is-active --quiet umamusume.service; then
  systemctl stop umamusume.service
fi
systemctl start "$SERVICE"
STARTED=1
for attempt in {1..30}; do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/release" >/dev/null; then break; fi
  sleep 1
done
node "$RELEASE/uma_tools/check_deployment.js" "http://127.0.0.1:$PORT" "$SHA"
MEDIA_PUBLISHED=1
node "$SRC/deploy/media-sync.js" publish "$RELEASE" "$ROOT/shared" "$WORK/media-backup"
for name in album_covers uma_avatars uma_moe uma_official uma_va video_thumbs uma_tools/img; do
  rm -rf "$RELEASE/$name"
  mkdir -p "$(dirname "$RELEASE/$name")"
  ln -s "$ROOT/shared/$name" "$RELEASE/$name"
done
chown -R "$UMA_USER:$UMA_USER" "$ROOT/shared"
cp "$ROOT/deploy/nginx-uma-live-wiki.conf" "$WORK/previous-nginx.conf"
sed -e "s|root /var/www/umamusume/current;|root $RELEASE;|" -e "s|127.0.0.1:8080|127.0.0.1:$PORT|" "$RELEASE/deploy/nginx-uma-live-wiki.conf" > "$ROOT/deploy/nginx-uma-live-wiki.conf.next"
mv -f "$ROOT/deploy/nginx-uma-live-wiki.conf.next" "$ROOT/deploy/nginx-uma-live-wiki.conf"
ACTIVATED=1
nginx -t
node "$SRC/deploy/deployment-state.js" activate "$ROOT" "$RELEASE" "$PORT"
systemctl reload nginx
node "$RELEASE/uma_tools/check_deployment.js" "${UMA_PUBLIC_URL:-https://umamusumelivewiki.top}" "$SHA"
systemctl is-active "$SERVICE"
systemctl enable "$SERVICE"
systemctl disable "$OLD_SERVICE" 2>/dev/null || true
systemctl disable --now umamusume-restart.timer 2>/dev/null || true
for name in update.sh rollback.sh drain-release.sh; do install -m 0755 "$RELEASE/deploy/$name" "$ROOT/deploy/$name"; done
install -m 0644 "$RELEASE/deploy/deployment-state.js" "$ROOT/deploy/deployment-state.js"
install -m 0644 "$RELEASE/uma_tools/news-content.js" "$ROOT/deploy/news-content.js"
install -m 0644 "$RELEASE/uma_tools/check_deployment.js" "$ROOT/deploy/check_deployment.js"
install -m 0644 "$RELEASE/deploy/nginx-uma-live-wiki.conf" "$ROOT/deploy/nginx-template.conf"
install -m 0644 "$RELEASE/deploy/umamusume-update.service" /etc/systemd/system/umamusume-update.service
install -m 0644 "$RELEASE/deploy/umamusume-update.timer" /etc/systemd/system/umamusume-update.timer
systemctl daemon-reload
systemctl enable --now umamusume-update.timer
if crontab -l > "$WORK/root-cron" 2>/dev/null; then
  awk '!(/\/var\/www\/umamusume/ && /git pull/)' "$WORK/root-cron" > "$WORK/root-cron-next"
  crontab "$WORK/root-cron-next"
fi
systemd-run --unit="uma-drain-$PORT-$(date +%s)" --on-active=30m /bin/bash "$ROOT/deploy/drain-release.sh" "$OLD" "$OLD_SERVICE"
node "$RELEASE/deploy/cleanup-releases.js" "$ROOT" "$SHA" "$OLD"
ACTIVATED=0
MEDIA_PUBLISHED=0
COMPLETE=1
echo "Published $SHA on $PORT. Previous streams drain for up to 30 minutes; daily main deployment is scheduled at 04:00 Asia/Shanghai."
