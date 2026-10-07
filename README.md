# 赛马娘LIVE综合站

一个零构建的赛马娘演唱会/LIVE 资讯站，由单页 HTML、浏览器版 Vue 3、按页面读取的目录接口和零依赖 Node.js 服务驱动。

- 在线站点：https://umamusumelivewiki.top/zh-Hans
- 本仓库：https://github.com/516735955/uma-live-wiki
- 技术栈：HTML/CSS/JS + Vue 3 浏览器运行时 + Node.js + Python（抓取/数据处理脚本）

## 目录结构

```
uma-live-wiki/                    仓库根目录
├── 赛马娘LIVE相关.html            SPA 页面结构
├── data/                          站点运行数据（JS / JSON）
│   ├── character_index_data.js    角色索引（181 个角色）
│   ├── character_detail_data.js   角色详情
│   ├── pedigree_source.json       可维护的原型马、亲本与角色映射源数据
│   ├── pedigree_data.js           由源数据生成的浏览器血统关系（window.PED_REL）
│   ├── albums.json                专辑与歌曲
│   ├── live_data.json             编号系列公演与歌单
│   ├── live_cat_data.json         其他演唱会分类/曲目
│   ├── events/                    活动、节目、声优身份与人工订正源数据
│   ├── events_catalog.json        统一活动目录（生成）
│   ├── song_catalog.json          统一歌曲、版本与收录关系（生成）
│   ├── creator_catalog.json       创作者、参与歌曲与合作关系（生成）
│   ├── music/                     版本级创作署名、歌词、时间轴与人工订正源数据
│   ├── appearance_index.json      角色、声优、歌曲出演关系（生成）
│   ├── voice_actor_profiles.json  声优资料及其站内关系（生成）
│   ├── catalog_manifest.json      本次生成物、覆盖率与输入摘要（生成）
│   └── ...
├── album_covers/                  外部源较慢的专辑封面本地 WebP 副本
├── uma_avatars/ uma_moe/ uma_official/ uma_va/ video_thumbs/  图片资源
├── uma_tools/                    工具脚本
│   ├── app.css                   站点样式
│   ├── music-components.css      音乐域卡片、详情与播放器组合样式
│   ├── app.js                    SPA 路由与页面逻辑
│   ├── app-api.js                目录请求去重与浏览器缓存
│   ├── ui-components.js          全站共用交互组件
│   ├── character-ui.js           角色/声优页按需加载逻辑
│   ├── catalog-store.js          统一生成物的内存快照与查询投影
│   ├── server.js                 静态文件与站内 API 服务（零依赖）
│   ├── img/                       工具和页面共用的零散图片
│   └── *.py *.js                  抓取/处理/校验脚本
└── .gitignore
```

## 本地启动 / 预览

普通预览只需要 Node.js（建议 ≥ 14）。在仓库根目录执行：

```bash
node uma_tools/server.js --no-crawl
# 或：npm --prefix uma_tools run serve
```

服务器默认监听 `http://localhost:8080`，以当前仓库根目录为站点根目录，自动优先返回
`index.html` 或 `赛马娘LIVE相关.html`。`--no-crawl` 只关闭后台抓取，页面与站内 API 均可正常预览，
也不会在启动时改写数据文件。

需要在维护工作树中显式刷新活动、角色、专辑和 Lantis 新闻时，使用：

```bash
node uma_tools/server.js
# 或：npm --prefix uma_tools run serve:auto
```

该模式会修改仓库数据，不应用作生产站点的启动命令。服务器在 Windows 上默认调用 `python`，
在 macOS/Linux 上默认调用 `python3`。如果 Python 3
使用其他命令名，可在启用自动刷新时通过 `PYTHON_BIN` 指定，例如：

```bash
PYTHON_BIN=/path/to/python3 node uma_tools/server.js
```

如需关闭服务器：终端 Ctrl+C。

## 数据格式约定

`data/*.js` 数据文件通过 `window.变量名 = {...}` 挂载，例如 `window.UMA_VIDEOS`、`window.PED_REL`；
`data/*.json` 由 `catalog-store.js` 作为一个版本一致的服务端快照读取，页面只请求列表摘要或当前详情，
不再下载整份活动、歌曲和出演关系。改动数据文件后服务端会在下一次请求时原子切换到新版本；若生成过程
尚未完成，则继续提供上一份完整快照。

血统数据的维护入口是 data/pedigree_source.json，以下命令生成浏览器使用的 data/pedigree_data.js

```bash
python3 uma_tools/build_pedigree.py
```

源数据记录父母、角色原型映射、繁育年份、繁育结果和核验来源；三代祖先、两代内角色后代、角色兄弟姐妹及
后代路径中的共同育种亲本由脚本统一推导。

当前 1223 条直接亲本记录均已完成来源核验：22 条来自 JBIS-Search，1201 条来自 netkeiba 的具体
赛马血统页。source: "jbis" 与 source: "netkeiba" 表示对应核验来源，节点同时保存可访问的具体
资料页。181 个角色页均有明确映射，其中 160 个赛马映射统一使用 kind: "horse"，其余角色按原创
角色或非赛马角色维护

160 个现实赛马角色页统一嵌入交互血统组件，默认展示三代祖先、已有角色页的同辈与两代内后代，
并展示有角色页的繁育关联。43 匹角色母马均已完成繁育履历核验，当前收录 70 对角色马之间的关系、
88 条逐年记录，其中 22 条为未产驹记录。角色详情页是血统关系的唯一用户入口。

原型马解说视频格式（`window.UMA_VIDEOS`，当前 160 个角色）：

```js
'角色key': [
  { "n": "视频标题", "bv": "BV1xxxxx" },   // 有视频：标题 + BV 号
  { "n": "原型马解说 暂无视频" }             // 无视频：占位条目（只渲染文字，不可点）
]
```

## 页面版本号

按需加载的 `*_data.js` 地址在 `uma_tools/app.js` 中保留版本参数（用于上线后强制刷新缓存）。
修改对应 JavaScript 数据文件并准备上线时，再更新该文件地址上的版本参数。

## 数据维护

脚本均从自身位置解析仓库根目录，不依赖某台电脑的绝对路径。常用入口如下：

| 数据 | 手动命令 | 主要输出 |
|---|---|---|
| Eventernote 活动 | `python3 uma_tools/crawl_events.py` | `data/events_data.json`；存在本地 Excel 镜像时会尝试同步 |
| 官方节目源 | `python3 uma_tools/update_events.py --refresh-programs` | 刷新 `data/events/official_programs.json` 并重建统一活动数据 |
| 声优资料源 | `python3 uma_tools/update_events.py --refresh-profiles` | 刷新 `data/events/voice_actor_details.json` 并重建声优档案 |
| 统一活动、音乐与出演关系 | `python3 uma_tools/update_events.py` | `events_catalog.json`、`song_catalog.json`、`appearance_index.json`、`voice_actor_profiles.json`、`catalog_manifest.json` |
| 音乐版本、创作者与歌词 | `python3 uma_tools/sync_music_metadata.py` | 增量合并 `data/music/`；已有非空人工资料不被空值或低置信结果覆盖 |
| 仅重建音乐目录 | `python3 uma_tools/update_events.py --music-only` | 重建歌曲、创作者及关联索引，不刷新或改写活动、节目、角色与声优源数据 |
| 全部远程源刷新 | `python3 uma_tools/update_events.py --refresh-all` | 刷新节目、声优资料并原子重建三份运行数据 |
| 角色增量 | `python3 uma_tools/crawl_characters.py` | 角色索引、详情与图片；人工步骤见 `uma_tools/角色与声优爬取流程.md` |
| 血统关系 | `python3 uma_tools/build_pedigree.py` | `data/pedigree_data.js`；完成后运行 `python3 uma_tools/check_pedigree.py` |
| 专辑与歌曲 | `python3 uma_tools/auto_albums.py` | `data/albums.json` |
| Lantis 新闻 | `python3 uma_tools/crawl_lantis_news.py` | `data/lantis_news.json`（CD相关快照，随仓库部署并热加载；服务内按需 TTL 补抓后合并进 `news_snapshot.json`，失败保留旧数据） |
| 活动数据校验 | `python3 uma_tools/update_events.py --check` | 只读重建并核对已提交生成物，不写文件 |

修改 `data/events_data.json`、`data/live_data.json` 或 `data/live_cat_data.json` 后，应再运行一次
`python3 uma_tools/update_events.py`。它从仓库内受版本控制的源数据统一重建活动、歌曲与出演关系，
不需要 `events_list.xlsx`。`live_data.json` 与 `live_cat_data.json` 是已发布歌单的唯一来源：构建器只读，
并在构建前后校验哈希；这两份文件没有记录的活动默认没有演出歌曲，程序不会从节目标题、出演阵容或其他来源猜歌。
Google Sheet 的定时任务是唯一的歌单补录入口：`auto_setlists.py` 仅在标题、日期、场次唯一匹配且对应已发布歌单为空、
出演信息完整时，补入 `live_cat_data.json` 的空白曲目表；已有非空歌单的曲目或歌手差异只写入工作流报告，
留待人工处理，不自动覆盖、不发提醒邮件。服务器的常规资料刷新不运行这项任务。

音乐资料按“歌曲作品 → 录音版本 → 专辑收录 / 现场演出”组织。`data/music/credits.json`、`lyrics.json`、
`lyric_timings.json` 和 `version_overrides.json` 是可维护源；`song_catalog.json` 与 `creator_catalog.json` 是生成物。
普通短版、现场标注等没有独立录音依据的名称只作为演出版本说明，不凭空生成“0 张收录”的录音版本；已确认的
署名和歌词按版本继承，明确的版本级资料优先。只调整音乐资料时使用 `--music-only`，避免无关数据产生大面积 diff。

## 前端组件复用

筛选下拉、分页、加载状态和底部播放器等交互由 `uma_tools/ui-components.js` 统一提供；新增页面应先复用
`UiSelect`、既有筛选按钮、实体标签和人物圆形链接，不在页面模板内复制另一套交互。全站 token、布局基线和
通用实体详情写在 `app.css`，音乐页只在 `music-components.css` 组合歌曲卡片、创作者关系、歌词和批量入队样式。
领域样式可以独立维护，但不得重新定义全站颜色、字号、按钮和下拉框基础规则。

`data/events/voice_actor_identities.json` 是稳定声优 ID 与别名的唯一登记表；角色当前担当关系来自角色索引，
活动、歌曲和声优页只消费统一生成物，不再各自维护一份映射。外部页面可以同时作为事实核验依据，但每个
最终字段只由生成器选定一份规范值。

正常启动 `uma_tools/server.js` 时，每 6 小时按“角色 → Eventernote → 专辑 → 官方节目/声优资料 → 统一生成”
的顺序串行刷新一次；同一时刻只运行一条链路，刷新中收到的下一次请求会合并为一次后续运行。CD相关（Lantis）
与官网新闻同一套机制：按需 TTL（官网 15 分钟、CD 30 分钟）在后台自动补抓，抓取结果合并进
`data/news_snapshot.json` 发布快照——CD 更新只重建合并列表，不重抓官网接口；失败保留旧数据并按 TTL 退避，
`data/lantis_news.json` 被 git 部署或手工更新后也会热加载并自动并入快照。`data/news_snapshot.json` 是最近一次
完整新闻结果（含 CD相关）的发布快照，服务器启动后立即提供，再在后台更新；它不是可编辑资料源。本地预览可使用 `--no-crawl` 关闭全部后台刷新。

生产环境可将 [`deploy/nginx-uma-live-wiki.conf`](deploy/nginx-uma-live-wiki.conf) 包含进 HTTPS server block，
使文本资源启用 gzip、图片使用长期缓存，并将 `/api/` 交给 Node 服务。发布后可用以下命令校验目录投影：

生产 Node 服务使用 [`deploy/umamusume.service`](deploy/umamusume.service)，启用服务内自动刷新：启动即抓新闻，
访问新闻接口时官网新闻缓存超过 15 分钟、CD相关 超过 30 分钟会在后台补抓并合并进快照；活动、角色、专辑与官方节目每 6 小时串行刷新一次。
刷新结果写回仓库内 `data/`，而运行中的服务读取的是启动时的目录缓存，因此用
[`deploy/umamusume-restart.timer`](deploy/umamusume-restart.timer) 每天凌晨 2 点重启一次，让目录改动生效；
新闻不依赖重启（会实时更新）。

推荐使用一键更新脚本（服务器无需安装 git，任意目录执行）：

```bash
curl -fsSL https://raw.githubusercontent.com/516735955/uma-live-wiki/main/deploy/update.sh | sudo bash
```

脚本会下载 main 分支快照同步到 `/var/www/umamusume`（可用首参数改为其他目录，`UMA_USER` 指定服务用户，
默认 `alaemiryoung`）、修正 `data/` 属主、安装并启用上述 systemd 单元、重启服务，最后跑一次部署自检。
无法访问 GitHub 时可把 `deploy/update.sh` 手工拷到服务器后 `sudo bash update.sh` 执行。

手工安装单元（不更新代码，仅装定时重启）时：

```bash
cd /var/www/umamusume
sudo install -m 0644 deploy/umamusume.service /etc/systemd/system/umamusume.service
sudo install -m 0644 deploy/umamusume-restart.service /etc/systemd/system/umamusume-restart.service
sudo install -m 0644 deploy/umamusume-restart.timer /etc/systemd/system/umamusume-restart.timer
sudo systemctl daemon-reload
sudo systemctl enable --now umamusume.service
sudo systemctl enable --now umamusume-restart.timer
```

用 git 维护生产检出时，自动刷新会改写其中的 `data/`（改动不属于 Git）；下次部署新提交前请先处理本地改动
（例如 `git checkout -- data` 或 `git stash`），避免与 `git pull` 冲突。本地预览仍可用 `--no-crawl` 关闭全部后台刷新。

```bash
npm --prefix uma_tools run test:catalog
npm --prefix uma_tools run check:deployment -- https://umamusumelivewiki.top
```

第二条命令会读取实际页面引用的带版本 CSS、JS，核对 gzip、长期缓存及新闻 API 响应头；若 nginx
配置未被当前 HTTPS server block 引用，会以非零状态退出并指出缺失的响应头。修改长期缓存的入口文件时，
必须同步更新页面或加载器中的 `?v=` 版本。

大部分抓取脚本只使用 Python 标准库。角色图片管线需要 Pillow：

```bash
python3 -m pip install Pillow
```

`openpyxl` 仅用于 `crawl_events.py` 对本地 `events_list.xlsx` / `voice_list.xlsx` 镜像的可选同步；
缺少这些文件或依赖不会阻止站点使用 JSON 数据。翻译结果缓存 `uma_tools/trans_cache.json`
随仓库维护；抓取日志与运行状态仍是本地产物，不提交。

## 协作流程

有仓库写权限的协作者使用功能分支和 Pull Request。一次 PR 可以包含多个小提交，
每个 commit 只处理一个明确问题；开发期间不必在每个 commit 前重复同步。

开始一批工作时同步一次 `main`：

```bash
git fetch origin main
git switch <工作分支>
git rebase origin/main
```

完成整批工作、准备提 PR 时，再同步一次并复验：

```bash
git fetch origin main
git rebase origin/main
# 运行与改动相称的代码、数据和页面复验
git push -u origin <工作分支>
gh pr create --base main --head <工作分支>
```

PR 标题使用英文概括本批目标，正文使用中文说明改了什么、如何验证以及兼容性影响。没有仓库写权限的贡献者
仍按 GitHub 的常规方式 Fork 仓库，从自己的功能分支向本仓库 `main` 提交 PR。

## 百度翻译配置

`uma_tools/server.js` 内置百度翻译缓存接口，读取顺序：

1. 环境变量 `BAIDU_APPID` / `BAIDU_SECRET`（临时覆盖时优先）
2. `uma_tools/baidu.conf.json`（项目默认配置，拉取后直接使用）

macOS / Linux：

```bash
BAIDU_APPID="你的APPID" BAIDU_SECRET="你的SECRET" node uma_tools/server.js
```

Windows PowerShell：

```powershell
$env:BAIDU_APPID = "你的APPID"
$env:BAIDU_SECRET = "你的SECRET"
node uma_tools/server.js
```

不配置时翻译功能自动降级（标题/正文保持日文），不影响其他功能。

## 常见问题

- **改了数据看不到变化？** 硬刷新 Ctrl+F5，或确认服务器读取的是「赛马娘LIVE相关.html」而非其他旧版文件。
- **文件很大/有临时产物？** 不要提交 `*.bak*`、`AI.rar`、`Default Project/`（官网抓取原始数据），
  以及 `uma_tools` 下的日志与运行状态文件；这些已在 `.gitignore` 中。翻译缓存
  `uma_tools/trans_cache.json` 是例外，它是站点可复用的数据结果。
- **想新增批量抓取的验证工具？** 放到 `uma_tools/` 下，命名如 `check_*.py`，并在提交前跑一遍语法检查。

## 致谢 / 数据来源

- 角色立绘与官方图片：赛马娘官网及相关公开资源
- 视频资源：B 站UP主公开视频（按角色整理原型马解说/歌曲）
- 站点由爱好者协作者共同维护，欢迎 PR 共建
