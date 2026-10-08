# 站点数据

## 可维护源

- `live_data.json`、`live_cat_data.json`：已精调的公演歌单；目录构建只读。
- `albums.json`：专辑、曲目和确认后的音源。
- 角色索引、角色详情、声优照片等 JS：浏览器按需读取的资料。
- `pedigree_source.json`：原型马、亲本及角色映射，生成 pedigree_data.js。
- [events](events/README.md)：活动、节目、声优身份和人工订正。
- [music](music/README.md)：录音版本、署名、歌词及时间轴。

## 生成目录

`events_catalog.json`、`song_catalog.json`、`creator_catalog.json`、`appearance_index.json`、`voice_actor_profiles.json`、`catalog_manifest.json` 由 update_events.py 从源数据统一生成。服务只发布完整的一组目录。

```bash
python3 uma_tools/update_events.py
python3 uma_tools/update_events.py --check
```

仅改音乐时使用 `--music-only`。署名与歌词按版本继承，明确版本资料优先；Off Vocal 不显示歌词。歌词时间轴保留在源数据中。

## 运行快照

`news_snapshot.json` 是最近一次完整新闻结果，`lantis_news.json` 是 CD 新闻抓取快照。服务热加载并持续更新；不是人工订正入口。部署保留服务器上已有的这两份快照及 uma_tools/trans_cache.json。

图片、日志、抓取状态的分工见 [工具说明](../uma_tools/README.md)。
