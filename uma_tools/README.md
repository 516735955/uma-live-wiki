# 运行与维护工具

## 前端

| 文件 | 职责 |
|---|---|
| `app.js`、`route-utils.js` | 页面状态、URL、导航 |
| `app-api.js` | 请求去重与有期限的浏览器缓存 |
| `ui-components.js` | 下拉、折叠、操作按钮、播放器界面 |
| `app.css` | 全站配色、布局和组件基础样式 |
| `music-components.css` | 音乐域的组合布局 |
| `player-controller.js` | 播放、队列、持久化和中断恢复 |
| `creator-network.js`、`character-ui.js` | 合作图谱和角色资料 |

新增交互复用 UiSelect、UiDisclosure、EntityActions；歌曲或人物详情使用现有实体布局。配色从全站 token 或角色双色取得。异步详情只在请求仍属于当前导航时发布；人物出演投影仅用于对应人物页，不覆盖完整歌曲缓存。

歌曲与活动列表使用服务端分页和检索，详情只加载当前实体。版本播放优先选择对应录音，找不到可播放音源时才回退到歌曲的默认录音。

## 服务

`server.js` 提供静态文件、新闻、翻译、目录 API 和自动刷新；`catalog-store.js` 加载一致的生成目录，刷新失败继续提供上一份完整快照。

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
| 专辑候选审核 | `node uma_tools/scrape.js` → 审阅 pending.json → `node uma_tools/apply.js` |

专辑导入保留季数和录音版本区别；新音源确认完整可播放后才写入链接。审核合并会同步重建音乐目录。角色和声优抓取细节见 [角色与声优爬取流程](角色与声优爬取流程.md)。

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
python3 uma_tools/check_pedigree.py
cd uma_tools
python3 -m unittest test_ingest_regressions test_update_events test_sync_music_metadata test_auto_setlists
```

检查生成物的输入摘要按内容比较，不把 Windows 与 Unix 换行差异视为数据变动。构建前后仍检查人工歌单是否被改写。
