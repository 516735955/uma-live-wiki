# 音乐版本元数据

这个目录保存不能从专辑和演出目录本身推导出来的版本级资料。`update_events.py` 会把它们合并到生成的歌曲与创作者目录中。

数据模型区分四个层级：

- 歌曲（work）：拥有稳定的歌曲 ID。
- 录音版本（recording version）：只在确认存在不同实际录音时拆分。
- 发行收录（release）：某个版本在专辑中的具体收录。
- 现场表演（performance）：某个版本在某场演出中的表演。

## 合并规则

1. 人工维护的非空记录和 `version_overrides.json` 始终保留。
2. 官方 Lantis 商品页用于确认收录曲对应的作词、作曲和编曲；默认只补空白分工，不覆盖已有非空署名。
3. 社区音乐目录与 Umamusume Wiki 只在曲名、录音版本和收录信息能够唯一对应时补空白；标题相同但身份不唯一的条目跳过。
4. 网易云音乐的已录入试听 ID 用于补全该录音的时间轴、歌词和缺失署名，不作为唯一资料源。
5. UtaTen 只补全能够同时匹配曲名和演唱者的日文歌词与缺失署名。
6. LRCLIB 只补全时间轴，并且只在它的歌词文本与已接受的歌词逐字规范化后完全一致时写入。
7. 不确定的翻译、拼音、假名或版本映射保持空白。Off Vocal / Instrumental 版本不继承歌词；短版只保存它实际演唱的歌词。

创作者使用稳定 ID；同一人的别名和所属信息在 `creators.json` 中合并。署名落在录音版本上，缺失字段在构建时直接继承原版，前端不额外标记继承状态。

## 维护命令

```bash
# 校验已提交文件，不访问网络
python3 uma_tools/sync_music_metadata.py --check

# 增量补全官方署名和已有试听的录音元数据
python3 uma_tools/sync_music_metadata.py

# 补全仍缺少的原文歌词，再为文本一致的版本补时间轴
python3 uma_tools/sync_music_metadata.py --utaten-only
python3 uma_tools/sync_music_metadata.py --lrclib-only

# 从结构化社区目录补空白署名，并从 Wiki 补唯一匹配的原文歌词
python3 uma_tools/sync_music_metadata.py --community-only

# 重新构建派生目录
python3 uma_tools/update_events.py
```

`source_status.json` 仅记录已成功查询过的资料源 ID，重复运行只查询新版本或上次网络失败的项目。需要重新获取单个版本时使用 `--refresh VERSION_ID`。
