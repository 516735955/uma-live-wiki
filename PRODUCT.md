# Product context

## Product

Uma Musume Live Wiki is a Chinese-language, fan-maintained web archive for researching the relationships among Uma Musume characters, voice actors, songs, releases, live performances, public appearances, and official programs.

The product should behave as one connected reference library rather than several isolated lists. A visitor should be able to start from an event, character, voice actor, song, or album and follow verified relationships to the other relevant records without losing context.

## Primary users and jobs

- Fans checking who appeared in an event or official program, what they performed, and where the information came from.
- Fans reviewing one character's or voice actor's participation history and, where applicable, sung-song history.
- Maintainers adding new official programs and appearances without manually editing several duplicate indexes.
- Maintainers preserving carefully curated live setlists while gradually improving the surrounding data model and navigation.

## Product principles

1. Treat concerts, onsite appearances, and identifiable official broadcasts as events in one shared chronology.
2. Keep series, event, and session distinct. A series contains events; an event may contain one or more sessions such as DAY1 and DAY2.
3. Store relationships with their evidence. Resolve a structured official character credit through the one current character-to-voice-actor mapping, but never treat an unstructured title or description mention as cast evidence.
4. Prefer official site announcements and official video metadata, then curated confirmations with an official source, then Eventernote as a supplementary source.
5. Preserve manually refined setlists exactly. `data/live_data.json` and `data/live_cat_data.json` remain source inputs and must not be rewritten by the unified event updater.
6. Generate shared event and appearance indexes from source data so pages do not maintain conflicting counts or histories.
7. Keep existing URLs usable while introducing clearer canonical routes.
8. Show incomplete information honestly. Records may be published with explicit pending or partial cast status when the event itself is verified.
9. Scope voice actor profiles to their Uma Musume participation and verified role information rather than attempting a general entertainment-industry filmography.
10. Preserve the existing Chinese interface and the project's non-official fan-site identity.

## Event scope

Included events are time-bound official activities with an identifiable program or appearance: music lives and concerts; onsite talks, release events, racecourse appearances, and public recordings; regular official programs such as PakaLive TV, PakaLive TV', SokoSoko PakaLive TV, and PakaTube programs with an identifiable episode and cast; anniversary, game, anime, or live retrospective specials; and externally produced programs supported by an official announcement.

Excluded items are ordinary promotional assets such as commercials, music videos, trailers, anime clips, Shorts, and uploads without a distinct program identity. In-character 3D content may create an appearance only when the official program metadata contains structured character credits; those credits resolve through the canonical current performer mapping.

## Technical constraints

- The current zero-build Vue frontend, Node server, and Python maintenance tools are the operating baseline.
- Active code and maintenance commands must remain portable across Windows, macOS, and Linux checkouts.
- Existing local files and manually maintained data are authoritative inputs and must be preserved.
- The site must remain usable when optional remote sources are unavailable; generated catalog files are committed artifacts.
- Updates must be repeatable, deterministic for the same inputs, and validated before replacing generated artifacts.
- Compatibility files and routes may remain during migration until every runtime consumer has moved to the unified indexes.

## Evidence in the repository

- Curated live and setlist sources: `data/live_data.json`, `data/live_cat_data.json`
- Existing appearance source: `data/events_data.json`
- Existing character and voice actor sources: `data/character_index_data.js`, `data/voice_list_data.js`, `data/va_photos_data.js`
- Current frontend and routes: `uma_tools/app.js`, `uma_tools/app.css`, `赛马娘LIVE相关.html`
- Current maintenance tools: `uma_tools/crawl_events.py`, `uma_tools/update_events.py`
