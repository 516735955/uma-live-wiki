"""CLI and compatibility exports for the canonical catalog pipeline."""
from events_pipeline.common import (
    ANN_PROGRAM_URL,
    Any,
    CAST_LABEL_RE,
    CAST_LINE_RE,
    CREATOR_ROLE_LABELS,
    CREATOR_ROLE_ORDER,
    Counter,
    DATA_DIR,
    DATE_RE,
    EVENTERNOTE_ID_RE,
    EVENTS_DIR,
    EVENT_COVER_BY_KIND,
    FULL_CAST_RE,
    GUEST_PERFORMER_RE,
    HTML_TAG_RE,
    IMMUTABLE_LIVE_FILES,
    Iterable,
    MEDIA_URL_RE,
    MUSIC_DIR,
    MUSIC_SOURCE_FILES,
    NON_PERFORMER_CAST_LABEL_RE,
    NUMBERED_EVENT_COVERS,
    OFFICIAL_CHANNEL_ID,
    OUTPUT_FILES,
    PAKALIVE_ARCHIVE_PAGES,
    PERFORMER_RE,
    PROGRAM_REFRESH_REPORT,
    PROGRAM_SOURCE_PRIORITY,
    Path,
    REGULAR_PROGRAM_BASELINES,
    ROOT,
    ROW_RE,
    SETLIST_NO_RE,
    SONG_RE,
    SONG_VERSION_HINT_RE,
    TOOLS_DIR,
    VFOLD,
    VOICE_DETAILS_FILE,
    VOICE_IDENTITIES_FILE,
    argparse,
    atomic_json,
    comparable,
    concurrent,
    defaultdict,
    dt,
    fetch_text_url,
    hashlib,
    html,
    json,
    os,
    re,
    read_json,
    read_window_data,
    sha256,
    shutil_which,
    subprocess,
    sys,
    tempfile,
    time,
    unicodedata,
    urllib,
)

from events_pipeline.text import (
    all_dates,
    clean_text,
    concise_program_summary,
    event_date_for_day,
    first_date,
    fold_name,
    stable_suffix,
    stable_title_suffix,
    unique_id,
    venue_from_date_text,
)

from events_pipeline.song_identity import (
    clean_song,
    effective_music_metadata,
    fold_song_key,
    is_instrumental_track,
    is_short_recording,
    pop_trailing_song_group,
    select_original_version,
    song_version_config,
    song_version_override,
    split_song_version,
    stable_album_id,
    stable_song_id,
    stable_version_id,
    table_characters,
    table_performances,
    table_songs,
)

from events_pipeline.music import (
    build_creator_catalog,
    build_song_catalog,
    release_vocalists,
)

from events_pipeline.identities import (
    IdentityIndex,
    cast_characters_for_session,
    cast_lines_for_session,
    cast_relation_key,
    make_cast,
    make_character_cast,
    merge_cast_records,
    parse_cast_text,
)

from events_pipeline.events import (
    add_programs,
    apply_overrides,
    attach_eventernote,
    cat_series_id,
    category_events,
    curated_media,
    dedupe_events,
    numbered_events,
    resolve_event_cover,
    series_lookup,
    title_series_id,
)

from events_pipeline.appearances import (
    build_appearance_index,
    enrich_profiles,
)

from events_pipeline.validation import (
    validate,
)

from events_pipeline.program_text import (
    expected_regular_program_ids,
    parse_intro_cast,
    parse_program_cast,
    parse_program_cast_line,
    parse_program_date,
    parse_program_sessions,
    program_identity,
    program_text_lines,
    canonical_program_title,
)

from events_pipeline.archives import (
    english_identity_key,
    historical_cast,
    historical_programs,
    official_radio_programs,
    plain_wikitext,
    wiki_archive_date,
    wiki_table_rows,
)

from events_pipeline.profiles import (
    apply_additive_voice_detail_refresh,
    balanced_template,
    clean_wikipedia_field,
    official_profile_photo,
    refresh_voice_actor_details,
    template_fields,
    voice_detail_from_wikipedia,
    wikipedia_biography_page,
    wikipedia_person_template,
    wikipedia_raw,
    wikipedia_title_key,
    wikipedia_voice_page,
)

from events_pipeline.program_discovery import (
    DiscoveryRows,
    announcement_identity,
    discover_channel_feed,
    discover_official_channel,
    fetch_json_url,
    fetch_video_metadata,
    is_official_program_announcement,
    is_official_program_candidate,
    is_official_special_video,
    is_pakatube_character_program,
    is_official_collaboration_program,
    official_news_programs,
    refresh_programs,
)

from events_pipeline.program_merge import (
    apply_additive_program_refresh,
    merge_program_list,
    value_is_present,
)

from events_pipeline.build import (
    build,
    build_music_only,
)

from events_pipeline.cli import (
    main,
)

if __name__ == "__main__":
    raise SystemExit(main())
