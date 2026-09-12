# Unified event sources

This directory contains maintainable source records for the unified event catalog.
Generated files live one directory above and must not be edited by hand.

## Files

- `series.json`: stable identities and display names for recurring event/program series.
- `official_programs.json`: official broadcast metadata collected from the official YouTube channel and official portal announcements. It is refreshed explicitly with `python3 uma_tools/update_events.py --refresh-programs` and remains usable offline after it is committed.
- `voice_actor_details.json`: cited biographical fields refreshed from Japanese Wikipedia, official-agency portrait fallbacks for people absent from the local photo index, and reviewed per-person corrections in `overrides.json`.
- `overrides.json`: small, reviewed corrections for source conflicts, aliases, missing cast, or intentionally hidden records. This is the only hand-edited event correction layer.

## Update workflow

Run `python3 uma_tools/update_events.py`. The command reads all existing event,
live, character, and voice sources, then atomically writes:

- `data/events_catalog.json`
- `data/song_catalog.json`
- `data/appearance_index.json`
- `data/voice_actor_profiles.json`

`song_catalog.json` is the shared music relationship index. It groups explicit
song versions under one work while retaining every original title, album track,
audio URL, live performance, character, and verified voice-actor relationship.
Setlist spellings and version annotations remain intact in `events_catalog.json`.
The statistics view derives its rows from these generated indexes; no parallel
compatibility indexes are generated.

Run `python3 uma_tools/update_events.py --check` in verification. It rebuilds in
memory, validates dates, evidence, episode continuity, identities, cast status,
profile-field accounting, stable IDs, and references, and checks that the generated files
match the source inputs without writing anything.

The command records SHA-256 digests of `live_data.json` and
`live_cat_data.json` before and after every build and fails if either changes.
Their hand-tuned setlist HTML is never normalized or rewritten.

## Evidence rules

Every cast relationship carries its evidence kind. The order of preference is:
official announcement, official YouTube metadata, curated official-source
confirmation, then Eventernote. A published record may be written only with a
verified cast, an explicitly character-only appearance, or an official
`announced_tba` status. A cast is never guessed from a title or character name.

PakaTube character programs are limited to full official episodes with a clear
program format, including gameplay, board games, drawing/chat streams,
watch-alongs, official on-location editions, and named talk/radio series.
Commercials, music videos, Shorts, trailers, anime clips, and one-off
promotional assets are excluded. Characters named in those records are linked
as fictional appearances only; they never create a voice-actor appearance
unless an official source names the voice actor separately.

Official special-program discovery also reads portal announcements for
PakaSpace watch-alongs and externally produced TV appearances. Multi-day
programs keep per-session dates and casts. When the same appearance already has
a hand-curated setlist record, `overrides.json` aliases the announcement to that
record so the official source is added without duplicating or replacing the
setlist.
