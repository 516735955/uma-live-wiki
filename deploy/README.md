# 部署

站点使用 `/var/www/umamusume`，服务用户由部署配置指定，Node 监听 8080。`current` 指向正在发布的代码目录；`shared/data`、翻译缓存和图片跨版本保留。

运行时翻译缓存保存在 `data/auto_update/trans_cache.json`。仓库的 `uma_tools/trans_cache.json` 和旧发布共享缓存作为初始翻译种子，只读取；新译文写入运行时目录。本机 `.impeccable/config.json` 属于设计工具状态，不参与代码发布。

## 更新

服务器自动解析 main 的具体提交、下载该提交并生成资源：

```bash
curl -fsSL https://raw.githubusercontent.com/516735955/uma-live-wiki/main/deploy/update.sh | sudo bash
```

本机发布已提交的确定版本：

```bash
node deploy/package-release.js HEAD /tmp/uma-release.tgz
```

上传压缩包和 update.sh 后：

```bash
sudo bash update.sh /var/www/umamusume /tmp/uma-release.tgz
```

发布串行执行，旧提交不能覆盖已上线的新提交。发布器按运行版本取得上次 Git 来源，将本次真正修改的字段应用到线上资料副本；未改动字段和线上增量记录保留。候选副本重建目录并启动临时实例验证，然后原子写入改动文件、切换 `current`、重载 nginx、重启正式服务。来源不完整、生成或验证失败就停止；公网验证失败时恢复上一版代码、配置及本次修改的数据与图片。

保留当前与上一版代码，其他旧代码版本自动清理；两版引用的资源始终保留，其他内容版本资源至少保留 30 天，供已打开的页面使用。相同内容共用同一个文件。首次切换保留原部署文件作为迁移恢复入口。发布期间取得现有自动更新锁，防止来源采集与发布互相覆盖。新闻快照、翻译缓存和来源尝试状态作为运行数据保留；临时来源副本、候选数据和回滚副本在结束后清理。

## 资源与版本

`prepare-release.js` 自动处理页面、原生模块、懒加载模板和血统 iframe 的 JS/CSS 引用，资源按内容生成文件名。入口 HTML 和可变 data JS 重新校验，`assets` 长期缓存。本地图片带发布版本参数，同路径订正随新页面取得新图；无版本图片重新校验。已打开的上一版页面仍可读取原脚本资源，不需用户清缓存。

`/api/release` 返回进程启动时的提交；入口 HTML 和 release.json 记录同一提交。检查实际运行版本，不以文件复制成功代替上线成功。

## 自动刷新

新闻每 30 分钟主动刷新；官网新闻 TTL 为 15 分钟，CD 新闻为 30 分钟。其他知识资料由 `sync_knowledge.py` 每日增量更新：官方角色与学园关系者、原型马与血统、活动与节目、专辑与歌单、音乐署名与歌词、声优资料、官方动画及其关联。网站每小时检查哪些步骤到期；成功步骤间隔 24 小时，失败来源一小时后重试，其余步骤继续。每日 02:00 重启不会重置更新期限。

`shared/data/auto_update` 保存最近一次执行状态和来源进度，跨发布保留；它不是审阅台。全流程只使用免费公开来源与本地解析，不调用付费模型。已有非空资料与人工订正保留，无法确定的字段留空；来源未披露的内容、无法唯一匹配的身份和未解析的新网站结构不编造补齐。图片只保存页面需要的本地版本，视频与音频保留来源链接。

服务器检查状态或立即执行某一项：

```bash
python3 uma_tools/sync_knowledge.py --status
python3 uma_tools/sync_knowledge.py --force --only characters pedigree-source pedigree-build
```

Python 依赖为 Pillow、beautifulsoup4 与 openpyxl；片尾还需要 FFmpeg、Tesseract 与支持当前公开视频协议的 yt-dlp。发布脚本会检查并安装，旧发行包的 yt-dlp 会用官方发行版更新。日文模型免费按需缓存。普通本地预览仍使用 `--no-crawl`，不会后台修改源数据。

Google 歌单表在服务器不可达时，读取已有 GitHub `sheet-sync` 工作流发布到 main 的资料；直连 GitHub 不可达时使用同仓库的 CDN 副本。备用入口同样只补唯一匹配、出演角色映射一致的空歌单，不替换线上已有歌单、日期或名单。

## 验证

```bash
node deploy/test_release.js
node deploy/test_data_sync.js
node uma_tools/check_deployment.js https://umamusumelivewiki.top <完整提交号>
systemctl is-active umamusume
```

部署检查针对准备好的发布包，核对 HTML、进程、发布包提交及全部入口/懒加载资源，并检查根地址、直链、目录 API 和新闻快照。PC 实际交互使用现有回归场景复核。
