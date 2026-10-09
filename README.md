# 赛马娘演出综合站

连接歌曲、专辑、演出、角色、声优和原型马的中文资料站。前端使用浏览器版 Vue 3，Node 服务提供静态页面和按页目录接口，Python 工具维护源数据与生成目录。无需构建。

[在线站点](https://umamusumelivewiki.top/) · [产品范围](PRODUCT.md) · [设计规范](DESIGN.md)

## 本地启动

需要 Node.js 18 或更新版本：

```bash
node uma_tools/server.js --no-crawl
```

打开 http://localhost:8080/。指定端口和站点目录：

```bash
node uma_tools/server.js 8091 . --no-crawl
```

普通预览关闭后台抓取，不写入数据。生产服务启用自动刷新，具体行为见 [部署说明](deploy/README.md)。

## 目录分工

| 位置 | 内容 |
|---|---|
| `赛马娘LIVE相关.html` | 页面模板 |
| [uma_tools](uma_tools/README.md) | 前端、API、抓取和校验工具 |
| [data](data/README.md) | 人工源数据、生成目录、运行快照 |
| [deploy](deploy/README.md) | 当前站点的更新与部署验证 |
| `album_covers/`、`uma_avatars/`、`uma_moe/`、`uma_official/`、`uma_va/`、`video_thumbs/` | 图片资源 |

## 常用维护

```bash
python3 uma_tools/update_events.py
python3 uma_tools/update_events.py --check
npm --prefix uma_tools run test:catalog
npm --prefix uma_tools run test:player
npm --prefix uma_tools run test:regressions
```

Python 3 命令在 Windows 可使用 `python`；服务和专辑合并工具支持 `PYTHON_BIN`。角色图片处理需要 Pillow；Excel 镜像同步可选安装 openpyxl。

改动人工源后重建对应目录；音乐资料单独调整使用 `update_events.py --music-only`。精调歌单、角色映射和已确认署名在源文件维护，不直接修改生成目录。

## 协作与发布

普通功能通过分支和 PR 合入 main，提交描述明确说明目标、验证和行为影响。页面交互优先复用现有组件，视觉规则遵循 DESIGN.md。发布工具自动生成前端资源地址并更新页面、懒加载和 iframe 引用，不手工维护 `?v=`。

翻译配置读取环境变量 `BAIDU_APPID` / `BAIDU_SECRET`，其次读取 `uma_tools/baidu.conf.json`。未配置时保留日文，不影响其他页面。

新闻人工订正在 `uma_tools/news-overrides.json` 维护，不写入机器缓存。术语直接复用角色与声优的日中名称，自动更新不覆盖人工订正。

站点由爱好者共同维护，角色图片、音乐资料和视频参考官网及相关公开资源。
