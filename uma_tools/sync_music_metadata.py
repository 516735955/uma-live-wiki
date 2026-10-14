"""CLI and compatibility exports for the canonical catalog pipeline."""
from music_pipeline.common import (
    Any,
    COMBINED_CREDIT_RE,
    CREATORS_FILE,
    CREDITS_FILE,
    CREDIT_LINE_RE,
    DATA_DIR,
    HTMLParser,
    LRCLIB_SEARCH_URL,
    LYRICS_FILE,
    LYRIC_URL,
    MUSIC_DIR,
    NAME_VARIANTS,
    NO_LYRIC_RE,
    OSHIKATSU_URL,
    OVERRIDES_FILE,
    Path,
    ROLE_LABELS,
    ROLE_ORDER,
    ROLE_SOURCE_LABEL,
    ROOT,
    SONGS_FILE,
    SOURCE_STATE_FILE,
    SUPPORTED_ROLES,
    TIMED_LINE_RE,
    TIMINGS_FILE,
    UA,
    UMAMUSU_WIKI_API,
    UMAMUSU_WIKI_CATEGORY,
    UTATEN_SEARCH_URL,
    argparse,
    concurrent,
    hashlib,
    html,
    json,
    os,
    re,
    read_json,
    time,
    unicodedata,
    urllib,
    write_json,
)

from music_pipeline.lyrics import (
    canonicalize_lyrics,
    clean_wiki_lyric_cell,
    folded_lyric,
    language_of,
    lyric_document_lines,
    lyric_line_key,
    lyric_subsequence,
    milliseconds,
    normalize_lyric_line,
    normalize_lyric_lines,
    parse_lyric,
    parse_wiki_song,
    stable_lyric_line_id,
    timing_line_positions,
)

from music_pipeline.credits import (
    creator_identity,
    creator_rows,
    credit_names,
    inferred_remix_credit,
    merge_credit_rows,
    normalize_automatic_credit_rows,
    official_credit_rows,
    parse_credit_text,
    parse_oshikatsu_credits,
    split_creators,
    stable_creator_id,
)

from music_pipeline.recordings import (
    catalog_key,
    choose_candidate,
    clean_markup,
    folded_title,
    match_recording_version,
    normalized_name,
    track_id,
    version_recordings,
)

from music_pipeline.sources import (
    fetch_text,
    fetch_track,
    wiki_api,
    wiki_page_wikitext,
    wiki_song_pages,
)

from music_pipeline.utaten import (
    UtaTenLyricParser,
    artist_match,
    fetch_utaten,
    json_ld_composition,
    utaten_artist_names,
    utaten_search_result,
    verify_utaten_source,
)

from music_pipeline.timings import (
    apply_lrclib_results,
    fetch_lrclib_timing,
)

from music_pipeline.documents import (
    apply_utaten_results,
    build_documents,
)

from music_pipeline.cli import (
    main,
)

if __name__ == "__main__":
    raise SystemExit(main())
