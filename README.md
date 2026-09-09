# 赛马娘LIVE综合站

一个零构建的赛马娘演唱会/LIVE 资讯站，由单页 HTML、浏览器版 Vue 3、按需加载的数据文件和零依赖 Node.js 服务驱动。

- 在线站点：https://umamusumelivewiki.top/zh-Hans
- 本仓库：https://github.com/516735955/uma-live-wiki
- 技术栈：HTML/CSS/JS + Vue 3 浏览器运行时 + Node.js + Python（抓取/数据处理脚本）

## 目录结构

```
uma-live-wiki/                    仓库根目录
├── 赛马娘LIVE相关.html            SPA 页面结构
├── *_data.js                      window 全局变量形式的数据文件（按页面加载）
│   ├── character_index_data.js    角色索引（179 个角色）
│   ├── character_detail_data.js   角色详情
│   ├── pedigree_data.js           血统关系（1334 条，window.PED_REL）
│   └── ...
├── live_data.json                 编号系列公演与歌单
├── live_cat_data.json             其他演唱会分类/曲目
├── events_data.json               活动数据
├── albums.json                    专辑数据
├── uma_avatars/ uma_moe/ uma_official/ uma_va/ role_svgs/ video_thumbs/  图片资源
├── 血统表/                       血统图表
├── uma_tools/                    工具脚本
│   ├── app.css                   站点样式
│   ├── app.js                    SPA 逻辑
│   ├── server.js                 静态文件与站内 API 服务（零依赖）
│   └── *.py *.js                  抓取/处理/校验脚本
└── .gitignore
```

## 本地启动 / 预览

需要 Node.js（建议 ≥ 14）与 Python 3（抓取脚本用）。在仓库根目录执行：

```bash
node uma_tools/server.js
```

服务器默认监听 `http://localhost:8080`，以当前仓库根目录为站点根目录，自动优先返回
`index.html` 或 `赛马娘LIVE相关.html`。浏览器打开预览即可。

服务器在 Windows 上默认调用 `python`，在 macOS/Linux 上默认调用 `python3`。如果 Python 3
使用其他命令名，可通过 `PYTHON_BIN` 指定，例如：

```bash
PYTHON_BIN=/path/to/python3 node uma_tools/server.js
```

如需关闭服务器：终端 Ctrl+C。

## 数据格式约定

`*.js` 数据文件通过 `window.变量名 = {...}` 挂载，例如 `window.UMA_VIDEOS`、`window.PED_REL`；
`*.json` 数据由页面按需请求。改动数据文件后**硬刷新**（Ctrl+F5）即可生效。

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

## 协作流程（普通成员）

仓库是 GitHub 上公开仓库。两种方式：

### 方式 A：直接推送到 main（适合你作为站长的常态工作）

```bash
git pull                        # 先同步远端最新改动
# ... 编辑文件 ...
git add .
git commit -m "描述本次改动"
git push origin main            # 推到 GitHub
```

### 方式 B：他人贡献（Pull Request 流程，站长评审后合并）

1. 在 GitHub 上 **Fork** 本仓库；
2. Clone 自己的 Fork，新建分支 `git checkout -b fix-xxx`；
3. 修改后提交并推到自己的 Fork；
4. 在 GitHub 页面发起 Pull Request；
5. 由仓库管理员（站长）评审、合并。

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
  `uma_tools` 下的日志/缓存（server.log、trans_cache.json 等）以及任何密钥；这些已在 `.gitignore` 中。
- **想新增批量抓取的验证工具？** 放到 `uma_tools/` 下，命名如 `check_*.py`，并在提交前跑一遍语法检查。

## 致谢 / 数据来源

- 角色立绘与官方图片：赛马娘官网及相关公开资源
- 视频资源：B 站UP主公开视频（按角色整理原型马解说/歌曲）
- 站点由一人维护，欢迎 PR 共建
