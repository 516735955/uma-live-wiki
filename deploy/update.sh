#!/usr/bin/env bash
# 一键更新生产：不需要 git，从 GitHub main 拉取代码 → 同步到站点目录 →
# 安装 systemd 单元（含每日 02:00 重启定时器）→ 重启服务 → 部署自检。
#
# 用法（服务器上执行，任意目录均可）：
#   curl -fsSL https://raw.githubusercontent.com/516735955/uma-live-wiki/main/deploy/update.sh | sudo bash
#   或离线拷贝本文件后：sudo bash update.sh [站点目录]（默认 /var/www/umamusume）
#
# 可用环境变量：
#   UMA_USER  运行 node 服务的系统用户（默认 alaemiryoung）
set -euo pipefail

ROOT="${1:-/var/www/umamusume}"
UMA_USER="${UMA_USER:-alaemiryoung}"
REPO_TARBALL="https://codeload.github.com/516735955/uma-live-wiki/tar.gz/refs/heads/main"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> 下载最新代码"
curl -fsSL "$REPO_TARBALL" -o "$WORK/main.tgz"
tar -xzf "$WORK/main.tgz" -C "$WORK"
SRC="$WORK/uma-live-wiki-main"

echo "==> 同步到 $ROOT（保留服务器本地生成的缓存/日志）"
mkdir -p "$ROOT"
cp -a "$SRC/." "$ROOT/"

if [ "$(id -u)" = "0" ]; then
  echo "==> 修正属主为 $UMA_USER（否则服务写不了 data/ 快照）"
  chown -R "$UMA_USER:$UMA_USER" "$ROOT"
fi

echo "==> 安装 systemd 单元"
install -m 0644 "$ROOT/deploy/umamusume.service" /etc/systemd/system/umamusume.service
install -m 0644 "$ROOT/deploy/umamusume-restart.service" /etc/systemd/system/umamusume-restart.service
install -m 0644 "$ROOT/deploy/umamusume-restart.timer" /etc/systemd/system/umamusume-restart.timer
systemctl daemon-reload
systemctl enable --now umamusume.service
systemctl enable --now umamusume-restart.timer

echo "==> 重启服务载入新代码"
systemctl restart umamusume.service
sleep 3

echo "==> 自检"
if command -v node >/dev/null 2>&1; then
  node "$ROOT/uma_tools/check_deployment.js" http://127.0.0.1:8080 || echo "（自检未完全通过，请查看上方条目）"
fi
systemctl is-active umamusume.service && systemctl list-timers | grep -F umamusume || true

echo "==> 完成。外网复核：npm --prefix uma_tools run check:deployment -- https://umamusumelivewiki.top"
