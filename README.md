# 赛马娘LIVE综合站

一个零构建的赛马娘演唱会/LIVE 资讯站，由单页 HTML、浏览器版 Vue 3、按需加载的数据文件和零依赖 Node.js 服务驱动。

- 在线站点：https://umamusumelivewiki.top/zh-Hans
- 本仓库：https://github.com/516735955/uma-live-wiki
- 技术栈：HTML/CSS/JS + Vue 3 浏览器运行时 + Node.js + Python（抓取/数据处理脚本）

## 目录结构

```
uma-live-wiki/                    仓库根目录
├── 赛马娘LIVE相关.html            SPA 页面结构
├── data/                          站点运行数据（JS / JSON）
│   ├── character_index_data.js    角色索引（179 个角色）
│   ├── character_detail_data.js   角色详情
│   ├── pedigree_source.json       可维护的原型马、亲本与角色映射源数据
│   ├── pedigree_data.js           由源数据生成的浏览器血统关系（window.PED_REL）
│   ├── albums.json                专辑与歌曲
│   ├── live_data.json             编号系列公演与歌单
│   ├── live_cat_data.json         其他演唱会分类/曲目
│   └── ...
├── album_covers/                  外部源较慢的专辑封面本地 WebP 副本
├── uma_avatars/ uma_moe/ uma_official/ uma_va/ video_thumbs/  图片资源
├── role_svgs/                     保留的旧版单角色血统 SVG（当前详情页不读取）
├── pedigree_assets/               当前全局血统页使用的静态 SVG（#5 将替换展示层）
├── uma_tools/                    工具脚本
│   ├── app.css                   站点样式
│   ├── app.js                    SPA 逻辑
│   ├── server.js                 静态文件与站内 API 服务（零依赖）
│   ├── img/                       工具和页面共用的零散图片
│   └── *.py *.js                  抓取/处理/校验脚本
├── archive/                       不参与运行的历史页面、旧数据和诊断快照
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

需要长期运行并自动刷新活动、角色、专辑和 Lantis 新闻时，使用：

```bash
node uma_tools/server.js
# 或：npm --prefix uma_tools run serve:auto
```

服务器在 Windows 上默认调用 `python`，在 macOS/Linux 上默认调用 `python3`。如果 Python 3
使用其他命令名，可在启用自动刷新时通过 `PYTHON_BIN` 指定，例如：

```bash
PYTHON_BIN=/path/to/python3 node uma_tools/server.js
```

如需关闭服务器：终端 Ctrl+C。

## 数据格式约定

`data/*.js` 数据文件通过 `window.变量名 = {...}` 挂载，例如 `window.UMA_VIDEOS`、`window.PED_REL`；
`data/*.json` 数据由页面按需请求。改动数据文件后**硬刷新**（Ctrl+F5）即可生效。

血统数据只编辑 `data/pedigree_source.json`，再运行
`python3 uma_tools/build_pedigree.py` 生成浏览器使用的 `data/pedigree_data.js`。源数据记录明确的
父、母和角色原型映射；三代祖先、子孙、角色兄弟姐妹及相关配种对象均由脚本推导，避免多处手工同步。
其中 `source: "jbis"` 表示亲本已直接对照 JBIS-Search，`source: "legacy"` 表示沿用仓库原有的
多来源资料、尚未在本轮逐条复核；新增或纠错时应优先直接核对 JBIS-Search，并保留真实来源标记。

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
| 角色增量 | `python3 uma_tools/crawl_characters.py` | 角色索引、详情与图片；人工步骤见 `uma_tools/角色与声优爬取流程.md` |
| 血统关系 | `python3 uma_tools/build_pedigree.py` | `data/pedigree_data.js`；完成后运行 `python3 uma_tools/check_pedigree.py` |
| 专辑与歌曲 | `python3 uma_tools/auto_albums.py` | `data/albums.json` |
| Lantis 新闻 | `python3 uma_tools/crawl_lantis_news.py` | `uma_tools/lantis_news.json`（运行时缓存） |
| 出演统计 | `python3 uma_tools/gen_voice_part.py` | `data/actor_participation.json`、`data/voice_participation.json` |

修改 `data/events_data.json`、`data/live_data.json` 或 `data/live_cat_data.json` 后，应再运行一次
`python3 uma_tools/gen_voice_part.py`。出演统计只读取仓库内受版本控制的数据，不需要 `events_list.xlsx`，
因此干净 clone 也能重建相同口径的结果。

大部分抓取脚本只使用 Python 标准库。角色图片管线需要 Pillow：

```bash
python3 -m pip install Pillow
```

`openpyxl` 仅用于 `crawl_events.py` 对本地 `events_list.xlsx` / `voice_list.xlsx` 镜像的可选同步；
缺少这些文件或依赖不会阻止站点使用 JSON 数据。翻译结果缓存 `uma_tools/trans_cache.json`
随仓库维护；抓取日志、运行状态和 `lantis_news.json` 仍是本地产物，不提交。

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

## 环境变量（重要：密钥不入库）

`uma_tools/server.js` 内置百度翻译缓存接口，**密钥不写入仓库**，通过环境变量注入：

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
- **文件很大/有 secrets？** 不要提交 `*.bak*`、`AI.rar`、`Default Project/`（官网抓取原始数据）、
  `uma_tools` 下的日志与运行状态文件以及任何密钥；这些已在 `.gitignore` 中。翻译缓存
  `uma_tools/trans_cache.json` 是例外，它是站点可复用的数据结果。
- **想新增批量抓取的验证工具？** 放到 `uma_tools/` 下，命名如 `check_*.py`，并在提交前跑一遍语法检查。

## 致谢 / 数据来源

- 角色立绘与官方图片：赛马娘官网及相关公开资源
- 视频资源：B 站UP主公开视频（按角色整理原型马解说/歌曲）
- 站点由爱好者协作者共同维护，欢迎 PR 共建
