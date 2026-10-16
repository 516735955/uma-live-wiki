# 部署

站点使用 `/var/www/umamusume`，Node 实例交替监听 8080、8081。`current` 指向正式代码，`shared/data` 指向当前完整资料目录；新闻数据库、翻译缓存和来源进度位于 `shared/runtime`，跨发布及代码回滚保留。

运行时翻译缓存保存在 `data/auto_update/trans_cache.json`。仓库的 `uma_tools/trans_cache.json` 和旧发布共享缓存作为初始翻译种子，只读取；新译文写入运行时目录。本机 `.impeccable/config.json` 属于设计工具状态，不参与代码发布。

## 更新

`umamusume-update.timer` 每天北京时间 04:00 启动发布。作业开始时解析 GitHub main 的完整提交；没有新提交就退出。服务器不需要 Git 工作区，下载确定提交的来源包完成发布。立即执行相同流程：

```bash
sudo systemctl start umamusume-update.service
systemctl list-timers umamusume-update.timer
journalctl -u umamusume-update.service -n 80 --no-pager
```

本机发布已提交的确定版本：

```bash
node deploy/package-release.js HEAD /tmp/uma-release.tgz
```

上传压缩包和 update.sh 后：

```bash
sudo bash update.sh /var/www/umamusume /tmp/uma-release.tgz
```

服务器下载 GitHub 来源缓慢时，可在本地用 `package-release.js <线上提交号> /tmp/uma-previous-release.tgz` 打包上一版，并与新包一起上传。把旧包作为更新脚本的第三个参数传入；脚本核对旧包提交号与运行版本一致，再执行同样的字段和图片同步。发布成功后删除上传的临时包。文件下载中断时最多尝试三次并续传；依赖安装只报告待重启服务，本站重启由发布流程统一执行。

发布串行执行，旧提交不能覆盖已上线的新提交。GitHub compare 判断完整提交关系，不局限于最近 100 个提交。发布器等待已有来源采集结束，最长六小时，期间旧站正常服务。它将 Git 真正改动的字段应用到独立的完整资料副本，保留线上新增记录与未改动字段，重建目录后启动备用实例。候选 API、入口和资源检查通过后，原子切换资料指针、代码指针和后台任务所有者，再平滑重载 nginx。来源、构建或检查失败时旧站继续服务；切换后公网验收失败，恢复旧站并保留运行时新闻和译文。

旧实例最多保留 30 分钟，让现有音频连接继续传输；新请求进入新实例。只有正式实例能启动后台采集和翻译，SQLite 翻译任务还使用事务领取。保留当前、上一版及端口仍引用的代码和完整资料目录；旧页面引用的其他内容版本资源至少保留 30 天。在线 SQLite 备份保留最近七份。首次迁移的旧新闻来源会在旧实例停止后合并，不能把旧快照直接覆盖到较新的归档上。

恢复上一版代码并继续使用当前资料、新闻及译文：

```bash
sudo bash /var/www/umamusume/deploy/rollback.sh
```

恢复前先用当前资料验证上一版接口；失败就保留现站。部署工具和定时入口保存在稳定的 `deploy` 目录，代码回滚不会把发布器退回旧版。每日任务仍可在下一次 04:00 发布 main。连续快速人工发布会复用备用端口，较早实例的排空时间可能短于 30 分钟。

## 资源与版本

`prepare-release.js` 自动处理页面、原生模块、懒加载模板和血统 iframe 的 JS/CSS 引用，资源按内容生成文件名。发布版按原有层叠顺序合并入口样式，并预加载启动所需的关键模块。入口 HTML 和可变 data JS 重新校验，`assets` 长期缓存。本地图片带发布版本参数，同路径订正随新页面取得新图；无版本图片重新校验。已打开的上一版页面仍可读取原脚本资源。

`/api/release` 返回进程启动时的提交；入口 HTML 和 release.json 记录同一提交。检查实际运行版本，不以文件复制成功代替上线成功。

## 自动刷新

新闻每 30 分钟主动刷新；官网新闻 TTL 为 15 分钟，CD 新闻为 30 分钟。其他知识资料由 `sync_knowledge.py` 每日增量更新：官方角色与学园关系者、原型马与血统、活动与节目、专辑与歌单、音乐署名与歌词、声优资料、官方动画及其关联。网站每小时检查哪些步骤到期；成功步骤间隔 24 小时，失败来源一小时后重试，其余步骤继续。原型马和声优分批处理、逐项保存进度。每日发布承担代码更新，不再依赖 02:00 定时重启。

新闻详情只读取 SQLite 中的日文原文和中文译文；页面中日切换不改变 URL，每次打开默认中文。历史文章由助手翻译后通过 `archive_news.py --import-translations` 导入。后续新增、修改的文章在后台翻译成功后固化，未变内容、同文段和仅图片或版式变化复用已完成译文。百度额度或鉴权错误暂停一小时并保存状态，访客访问不会调用百度。来源暂时不可达时保留已有完整归档。

百度凭据从环境变量 `BAIDU_APPID`、`BAIDU_SECRET` 或服务器本地 `uma_tools/baidu.conf.json` 读取；合作者在本地配置，或经 SSH 执行服务器更新命令。配置文件、SQLite、WAL/SHM 和运行状态不提供 HTTP 下载。`smoke_translation.js` 默认使用离线检查，只有显式传入 `--live` 才调用百度。

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
node deploy/test_deployment_state.js
node uma_tools/check_deployment.js https://umamusumelivewiki.top <完整提交号>
systemctl is-active umamusume@8080 umamusume@8081
```

部署检查针对准备好的发布包，核对 HTML、进程、发布包提交及全部入口/懒加载资源，并检查根地址、直链、目录 API 和新闻快照。PC 实际交互使用现有回归场景复核。
