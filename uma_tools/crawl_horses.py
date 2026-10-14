"""CLI and compatibility exports for the canonical catalog pipeline."""
from horses_pipeline.common import (
    CACHE_DIR,
    DATA_DIR,
    DETAIL_PREFIX,
    FIELD_ALIASES,
    JA_PATTERNS,
    JBIS_SLEEP,
    LIST_PREFIX,
    OUT_DETAIL,
    OUT_LIST,
    P,
    PEDIGREE_SOURCE,
    PHOTO_DIR,
    PROXY,
    ROOT,
    SKIP_HEADERS,
    TOOLS_DIR,
    UA,
    WIKI_SLEEP,
    ZH_PATTERNS,
    _NON_HORSE_PHOTO,
    _NON_HORSE_TITLE,
    _NON_HORSE_WIKI,
    _PHOTO_EXT,
    _PLACEHOLDER_MD5,
    _RACEHORSE_MARK,
    hashlib,
    html_lib,
    io,
    json,
    os,
    re,
    socket,
    sys,
    tempfile,
    time,
    urllib,
)

from horses_pipeline.transport import (
    _opener,
    _request,
    http_get,
)

from horses_pipeline.registry import (
    birth_precision,
    born_sort,
    build_horses,
    load_pedigree_source,
)

from horses_pipeline.wikipedia import (
    api_get,
    normalize_title,
    page_score,
    resolve_wikipedia,
    wiki_pageinfo,
    wiki_wikitext,
)

from horses_pipeline.photos import (
    _image_md5,
    _name_in_photo,
    _photo_tokens,
    _url_matches,
    _usable_photo,
    clean_photo_url,
    fill_missing_photo,
    imageinfo_url,
    localize_photo,
    photo_from_commons,
    photo_from_netkeiba,
    photo_from_wikitext,
)

from horses_pipeline.text import (
    _collapse_simple,
    bucket_for_header,
    collapse_templates,
    collect_paragraphs,
    extract_template,
    field_match,
    infobox_fields,
    parse_medals,
    plain_lines,
    split_extract_sections,
    split_top_level,
    strip_markup,
    strip_tags,
    template_span,
    trim_paragraphs,
    valid_date,
)

from horses_pipeline.races import (
    _grade_like,
    battle_count,
    fill_races,
    jbis_birth_matches,
    merge_races,
    parse_races,
    parse_tables,
    parse_wiki_races,
    search_jbis_url,
    wiki_races_for,
)

from horses_pipeline.profiles import (
    fetch_horse,
)

from horses_pipeline.cli import (
    atomic_write,
    main,
    serialize,
)

if __name__ == "__main__":
    raise SystemExit(main())
