#!/usr/bin/env bash
# 一键更新生产：不需要 git。同步代码到站点目录 → 安装 systemd 单元（含每日 02:00
# 重启定时器）→ 重载 nginx / 重启服务 → 部署自检。
#
# 用法（服务器上执行，任意目录均可）：
#   ① 能访问 GitHub：curl -fsSL https://raw.githubusercontent.com/516735955/uma-live-wiki/main/deploy/update.sh | sudo bash
#   ② GitHub 不通：把本机打好的压缩包 SFTP 上来后
#      sudo bash update.sh /var/www/umamusume /root/uma-live-wiki-main.tgz
#   ③ 仅本文件在手：sudo bash update.sh [站点目录] [本地压缩包]
#
# 可用环境变量：UMA_USER 运行 node 服务的系统用户（默认 alaemiryoung）
set -euo pipefail

ROOT="${1:-/var/www/umamusume}"
ARCHIVE="${2:-}"
UMA_USER="${UMA_USER:-alaemiryoung}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fetch() { curl -fL --connect-timeout 15 --max-time 3600 "$@"; }

if [ -n "$ARCHIVE" ]; then
  echo "==> 使用本地压缩包 $ARCHIVE"
  [ -f "$ARCHIVE" ] || { echo "找不到压缩包：$ARCHIVE"; exit 1; }
  cp "$ARCHIVE" "$WORK/main.tgz"
else
  echo "==> 下载最新代码（GitHub 主源，失败自动切镜像）"
  ok=0
  for url in \
    "https://codeload.github.com/516735955/uma-live-wiki/tar.gz/refs/heads/main" \
    "https://ghfast.top/https://github.com/516735955/uma-live-wiki/archive/refs/heads/main.tar.gz" \
    "https://ghproxy.net/https://github.com/516735955/uma-live-wiki/archive/refs/heads/main.tar.gz"; do
    echo "    尝试 $url"
    if fetch "$url" -o "$WORK/main.tgz"; then ok=1; break; fi
  done
  if [ "$ok" != 1 ]; then
    echo "下载失败。备选方案（不依赖 GitHub）："
    echo "  本机仓库执行  git archive --format=tar.gz -o uma-live-wiki-main.tgz main"
    echo "  把压缩包 SFTP 到服务器后：sudo bash update.sh $ROOT /路径/uma-live-wiki-main.tgz"
    exit 1
  fi
fi

echo "==> 解压"
mkdir -p "$WORK/x"
tar -xzf "$WORK/main.tgz" -C "$WORK/x"
if [ -d "$WORK/x/uma_tools" ]; then
  SRC="$WORK/x"                      # git archive 打包（无外层目录）
else
  SRC="$(find "$WORK/x" -mindepth 1 -maxdepth 1 -type d | head -1)"   # GitHub 打包（带外层目录）
fi
[ -d "$SRC/uma_tools" ] || { echo "解压内容异常：$SRC"; exit 1; }

echo "==> 同步到 $ROOT（保留服务器本地生成的缓存/日志）"
mkdir -p "$ROOT"
cp -a "$SRC/." "$ROOT/"

if [ "$(id -u)" = "0" ]; then
  echo "==> 修正属主为 $UMA_USER（否则服务写不了 data/ 快照）"
  chown -R "$UMA_USER:$UMA_USER" "$ROOT"
fi

# A root-run generator can leave 0600 output owned by root. Both Node and nginx
# need to read the published data after deployment.
find "$ROOT/data" -type d -exec chmod 0755 {} +
find "$ROOT/data" -type f \( -name '*.json' -o -name '*.js' \) -exec chmod 0644 {} +

if ! python3 -c 'import PIL' >/dev/null 2>&1; then
  echo "==> 安装角色图片管线依赖 Pillow"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y python3-pil
  else
    python3 -m pip install Pillow
  fi
fi

echo "==> 安装 systemd 单元"
install -m 0644 "$ROOT/deploy/umamusume.service" /etc/systemd/system/umamusume.service
install -m 0644 "$ROOT/deploy/umamusume-restart.service" /etc/systemd/system/umamusume-restart.service
install -m 0644 "$ROOT/deploy/umamusume-restart.timer" /etc/systemd/system/umamusume-restart.timer
systemctl daemon-reload
systemctl enable --now umamusume.service
systemctl enable --now umamusume-restart.timer

# The HTTPS server includes the repository's nginx config. Copying the file
# alone does not update nginx's in-memory locations or cache rules.
echo "==> 校验并重载 nginx"
nginx -t
systemctl reload nginx

echo "==> 重启服务载入新代码"
systemctl restart umamusume.service
echo "    等待启动抓取完成（新闻 20+ 页）..."
sleep 15

echo "==> 自检"
if command -v node >/dev/null 2>&1; then
  node "$ROOT/uma_tools/check_deployment.js" "${UMA_PUBLIC_URL:-https://umamusumelivewiki.top}"
fi
systemctl is-active umamusume.service
systemctl list-timers | grep -F umamusume || true

echo "==> 完成。外网复核：npm --prefix uma_tools run check:deployment -- https://umamusumelivewiki.top"
