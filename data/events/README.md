# Unified event sources

This directory contains maintainable source records for the unified event catalog.
Generated files live one directory above and must not be edited by hand.

## Files

- `series.json`: stable identities and display names for recurring event/program series.
- `official_programs.json`: official broadcast metadata collected from the official YouTube channel and official portal announcements. It is refreshed through the canonical builder with `python3 uma_tools/crawl_official_programs.py` and remains usable offline after it is committed.
- `voice_actor_details.json`: cited biographical fields refreshed from Japanese Wikipedia, official-agency portrait fallbacks for people absent from the local photo index, and reviewed per-person corrections in `overrides.json`.
- `voice_actor_identities.json`: the canonical registry of stable voice-actor IDs, names, and aliases. Generated catalogs never read their previous output to recover an identity.
- `overrides.json`: small, reviewed corrections for source conflicts, aliases, missing cast, or intentionally hidden records. This is the only hand-edited event correction layer.

## Update workflow

Run `python3 uma_tools/update_events.py`. The command reads all existing event,
live, character, and voice sources, then atomically writes:

- `data/events_catalog.json`
- `data/song_catalog.json`
- `data/appearance_index.json`
- `data/voice_actor_profiles.json`
- `data/catalog_manifest.json`

`song_catalog.json` is the shared music relationship index. It groups explicit
song versions under one work while retaining every original title, album track,
audio URL, live performance, character, and verified voice-actor relationship.
Setlist spellings and version annotations remain intact in `events_catalog.json`.
All user-facing relationship pages read these generated indexes; no parallel
statistics or compatibility indexes are generated.

Run `python3 uma_tools/update_events.py --check` in verification. It rebuilds in
memory, validates dates, evidence, episode continuity, identities, cast status,
profile-field accounting, stable IDs, and references, and checks that the generated files
match the source inputs without writing anything.

The command records SHA-256 digests of `live_data.json` and
`live_cat_data.json` before and after every build and fails if either changes.
Their hand-tuned setlist HTML is never normalized or rewritten.

Run `python3 uma_tools/crawl_official_programs.py --dry-run` before an official
program update. The same implementation used by the server discovers known
program series, validates a complete in-memory catalog, and writes an ignored
`program_refresh_report.json`. Discovery may add a new stable program or fill
an empty field. A different value for an existing nonempty field is reported
for review and is not applied automatically. Existing records that temporarily
disappear from an upstream listing are retained. Sources and media links are
additive. Running the command without `--dry-run` applies the safe result and
atomically rebuilds all generated catalogs; it does not refresh voice-actor
biographies.

## Evidence rules

Every published event cast relationship carries its evidence kind and resolves
to exactly one canonical Uma Musume voice-actor/character pair. Festival
artists, presenters, staff, and other people remain in source snapshots rather
than the event cast. A non-Uma singer on a collaboration song is retained only
on that exact setlist row. The order of preference is:
official announcement, official YouTube metadata, curated official-source
confirmation, then Eventernote. External sources may corroborate the same fact,
but the builder publishes one canonical value for each event field and one
canonical relationship for each entity. A cast is never guessed from an
unstructured title or a casual name mention.

PakaTube character programs are limited to full official episodes with a clear
program format, including gameplay, board games, drawing/chat streams,
watch-alongs, official on-location editions, and named talk/radio series.
Commercials, music videos, Shorts, trailers, anime clips, and one-off
promotional assets are excluded. A structured official character credit is
resolved through the single current character-to-voice-actor mapping; ordinary
mentions in a title or description never create an appearance. Historical
former performers remain separate profile facts and do not replace the current
mapping.

Official special-program discovery also reads portal announcements for
PakaSpace watch-alongs and externally produced TV appearances. Multi-day
programs keep per-session dates and casts. When the same appearance already has
a hand-curated setlist record, `overrides.json` aliases the announcement to that
record so the official source is added without duplicating or replacing the
setlist.

`live_data.json` and `live_cat_data.json` are the only source of performance
rows. Their curated HTML, ordering, labels, and source notes are preserved
verbatim. An event absent from those setlists has no songs by default; the
builder never infers a song from cast, media, or event metadata.
