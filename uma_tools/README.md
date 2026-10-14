# 运行与维护工具

## 前端

| 文件 | 职责 |
|---|---|
| `app.js`、`frontend/pages.js` | 启动、按需加载页面模板、模板请求恢复 |
| `frontend/domains/`、`route-utils.js` | 各业务域状态、路由、请求生命周期；跨域依赖在 `frontend/domains.js` 显式组装 |
| `frontend/views/` | 各页面模板；保留既有路由与组件结构 |
| `app-api.js` | 请求去重与有期限的浏览器缓存 |
| `ui-components.js` | 下拉、折叠、操作按钮、播放器界面 |
| `frontend/styles/`、`app.css` | 全站配色、布局和组件样式；`app.css` 保留兼容导入入口 |
| `media-url.js` | 本地图片的发布版本地址；同路径图片订正无需清浏览器缓存 |
| `music-components.css` | 音乐域的组合布局 |
| `player-controller.js` | 播放、队列、持久化和中断恢复 |
| `creator-network.js`、`character-ui.js` | 合作图谱和角色资料 |

新增交互复用 UiSelect、UiDisclosure、EntityActions；歌曲或人物详情使用现有实体布局。配色从全站 token 或角色双色取得。异步详情只在请求仍属于当前导航时发布；人物出演投影仅用于对应人物页，不覆盖完整歌曲缓存。

歌曲、活动、专辑与原型马列表使用服务端分页和检索。动画单集、反向关联、声优与马匹详情按范围读取；音乐关系在切到对应栏目后加载。专辑曲目按专辑与曲序解析身份，同名曲目不会互相替换。版本播放优先选择对应录音，找不到可播放音源时才回退到歌曲的默认录音。

## 服务

`server.js` 组装 `server-*.js` 的静态服务、新闻、翻译、目录 API、音频代理与调度。`catalog-store.js`、`anime-store.js`、`horse-store.js` 加载目录；刷新失败继续提供上一份完整快照。

`news-content.js` 统一新闻增量合并与人工订正优先级。`news-overrides.json` 的 `titles` 按日文原题保存订正；`messages` 按原文已有的 `msg_…` 标识保存订正文；`news` 按新闻 ID 保存图片等字段。原题或正文变化后，不套用旧译文。

`translation-terms.js` 从角色索引和声优资料取得统一名称，保护专名后调用百度 API，再恢复中文名。标记缺失或重复的结果不入缓存；HTML 标签和链接不参与翻译。`translation-cache.js` 合并单条结果，不用旧内存整份覆盖磁盘。人工订正独立于缓存；无需逐条审核新闻。后台补译每轮最多 20 条，交互请求优先。

正文使用 POST 分批翻译，批次按保护后的文本长度划分。文章原文取得后立即可读，译文在后台补齐；页面有界轮询进度。部分译文和来源原文不缓存成完整翻译，失败片段保持可重试。标题与正文共同核对数字、小数、时刻和星级。新闻订正绑定原文内容，原文更新后不套用旧正文订正。

`news-images.js` 仅缓存官网与 Lantis 新闻图片，浏览器通过 `/api/news-image` 读取相同原图；过期缓存立即可读并后台刷新。容量默认 256 MiB，可用 `NEWS_IMAGE_CACHE_BYTES` 配置。清理仅覆盖本缓存目录中的图片，不修改照片、封面或源数据。

实际 API 小样本检查：`node uma_tools/smoke_translation.js`。该命令不修改缓存，只输出原文和译文。

```bash
node uma_tools/server.js --no-crawl
node uma_tools/server.js
```

第二条启用后台源刷新，会更新 data。日志和抓取运行状态为本地产物。部署行为见 [deploy/README.md](../deploy/README.md)。

## 数据维护入口

| 任务 | 命令 |
|---|---|
| 重建活动、歌曲、出演目录 | `python3 uma_tools/update_events.py` |
| 只重建音乐及关联索引 | `python3 uma_tools/update_events.py --music-only` |
| 官方节目刷新 | `python3 uma_tools/update_events.py --refresh-programs` |
| 声优资料刷新 | `python3 uma_tools/update_events.py --refresh-profiles` |
| 音乐署名、歌词增量维护 | `python3 uma_tools/sync_music_metadata.py` |
| 血统生成与核验 | `python3 uma_tools/build_pedigree.py`、`python3 uma_tools/check_pedigree.py` |
| 专辑自动补全 | `python3 uma_tools/auto_albums.py` |
| 每日知识增量与失败重试 | `python3 uma_tools/sync_knowledge.py` |
| 最近一次自动更新状态 | `python3 uma_tools/sync_knowledge.py --status` |
| 动画官方资料增量 | `python3 uma_tools/sync_anime_sources.py` |
| 观看入口复检 | `python3 uma_tools/sync_anime_watch.py` |
| 公开片尾署名补充 | `python3 uma_tools/sync_anime_credits.py` |

专辑导入保留季数和录音版本区别；新音源确认完整可播放后才写入链接。普通增量流程直接补有证据的资料，不依赖人工审阅台。`update_events.py`、`crawl_horses.py`、`sync_music_metadata.py` 保留 CLI 和兼容导出，实际职责分别位于 `events_pipeline/`、`horses_pipeline/`、`music_pipeline/`。角色和声优抓取细节见 [角色与声优爬取流程](角色与声优爬取流程.md)。

每日流程使用 `sync_character_sources.py` 从官方分类和个人页补入马娘及有固定身份的学园关系者；不依赖社区词条先完成中文翻译。`sync_pedigree_sources.py` 按完全匹配的赛马词条补原型与明确亲本事实，未确定的映射使用 `unknown`，不标成原创角色或非马娘。`sync_anime_sources.py` 直接补官方公开剧集、署名、图片与明确关联，保留已有人工值；新官网的结构化剧集元数据可自动读取，未识别的结构保持未知。新记录缺少免费中文资料时显示来源原文。

活动的具体场次保存完整出演名单，主持、实况、嘉宾和向导继承所属分组的日期。角色与声优出演索引使用同一份场次数据，当前目录没有跨日活动的未定场次出演。活动列表的截断名单不会覆盖已取得的完整详情名单。

片尾采集需要 yt-dlp、FFmpeg、Tesseract 与免费日文语言模型。模型按需缓存；只读取有界公开视频片段，不保存视频或音频。工作目录与处理图在结束后删除，只保留支持已采用署名的最少证据帧。跨帧重复且高置信的文字才入库；完整人工核对记录保留。读取失败或没有足够证据返回失败状态，后续重试，不伪造缺失署名。

## 验证

在仓库根目录运行：

```bash
npm --prefix uma_tools run test:catalog
npm --prefix uma_tools run test:routes
npm --prefix uma_tools run test:brand
npm --prefix uma_tools run test:player
npm --prefix uma_tools run test:regressions
python3 uma_tools/update_events.py --check
python3 uma_tools/sync_music_metadata.py --check
python3 uma_tools/build_anime_catalog.py --check
python3 uma_tools/check_pedigree.py
python3 -m unittest discover -s uma_tools -p 'test_*.py'
node deploy/test_release.js
node deploy/test_data_sync.js
```

检查生成物的输入摘要按内容比较，不把 Windows 与 Unix 换行差异视为数据变动。构建前后仍检查人工歌单是否被改写。

CI 在 Linux 与 Windows 执行纯本地的源解析、生成目录和发布回归。浏览器验收使用 `test_image_viewer_browser.js`；它需要 Playwright 和 Chrome，可通过 `UMA_TEST_URL`、`CHROME_PATH` 指定已有本地预览与浏览器。
