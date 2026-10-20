"""Cli responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import credits as pipeline_credits
from . import documents as pipeline_documents
from . import lyrics as pipeline_lyrics
from . import recordings as pipeline_recordings
from . import sources as pipeline_sources
from . import timings as pipeline_timings
from . import utaten as pipeline_utaten


def main(argv: list[str] | None = None) -> int:
    parser = pipeline_common.argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=12, help="maximum concurrent metadata requests")
    parser.add_argument("--limit", type=int, default=0, help="fetch at most this many track IDs (development only)")
    parser.add_argument("--refresh", action="append", default=[], metavar="VERSION_ID", help="replace one version from its recording source")
    parser.add_argument("--utaten", action="store_true", help="also fill missing plain lyrics and credits from UtaTen")
    parser.add_argument("--utaten-only", action="store_true", help="skip NetEase and only run the UtaTen fallback")
    parser.add_argument("--lrclib", action="store_true", help="also add LRCLIB timings whose text matches accepted lyrics")
    parser.add_argument("--lrclib-only", action="store_true", help="skip other network sources and only run the LRCLIB timing fallback")
    parser.add_argument("--community", action="store_true", help="also fill exact matches from the community music catalog and Umamusume Wiki")
    parser.add_argument("--community-only", action="store_true", help="skip other network sources and only run the community fallbacks")
    parser.add_argument("--infer-remixers-only", action="store_true", help="offline: add only explicit name-from-title remixer credits")
    parser.add_argument("--normalize-lyrics-only", action="store_true", help="offline: rebuild canonical lyric documents and stable timing references")
    parser.add_argument("--revalidate-utaten", action="store_true", help="remove prior UtaTen matches whose credited artist does not match this recording")
    parser.add_argument("--skip-official", action="store_true", help="skip the official Lantis credit refresh")
    parser.add_argument("--check", action="store_true", help="validate committed music source documents without network access")
    args = parser.parse_args(argv)

    songs = pipeline_common.read_json(pipeline_common.SONGS_FILE, {"songs": []})
    recordings = pipeline_recordings.version_recordings(songs)
    source_state = pipeline_common.read_json(pipeline_common.SOURCE_STATE_FILE, {
        "schema_version": 1, "netease_checked": [], "utaten_checked": [], "lrclib_checked": [],
        "umamusu_wiki_checked": [],
    })
    netease_checked = set(source_state.get("netease_checked") or [])
    netease_checked_at = dict(source_state.get('netease_checked_at') or {})
    utaten_checked = set(source_state.get("utaten_checked") or [])
    utaten_checked_at = dict(source_state.get('utaten_checked_at') or {})
    lrclib_checked = set(source_state.get("lrclib_checked") or [])
    lrclib_checked_at = dict(source_state.get('lrclib_checked_at') or {})
    wiki_checked_at = dict(source_state.get('umamusu_wiki_checked_at') or {})
    umamusu_wiki_checked = {int(value) for value in source_state.get("umamusu_wiki_checked") or [] if str(value).isdigit()}
    overrides = pipeline_common.read_json(pipeline_common.OVERRIDES_FILE, {"schema_version": 1, "versions": {}})
    if not isinstance(overrides.get("versions"), dict):
        raise RuntimeError("data/music/version_overrides.json must contain a versions object")
    if args.check:
        creators = pipeline_common.read_json(pipeline_common.CREATORS_FILE, {})
        credits = pipeline_common.read_json(pipeline_common.CREDITS_FILE, {})
        lyrics = pipeline_common.read_json(pipeline_common.LYRICS_FILE, {})
        timings = pipeline_common.read_json(pipeline_common.TIMINGS_FILE, {})
        known = set(recordings)
        unknown = sorted((set((credits.get("versions") or {})) | set((lyrics.get("versions") or {})) | set((timings.get("versions") or {}))) - known)
        if unknown:
            raise RuntimeError("music metadata references unknown versions: " + ", ".join(unknown[:10]))
        creator_ids = [str(row.get("id") or "") for row in creators.get("creators") or []]
        if not all(creator_ids) or len(creator_ids) != len(set(creator_ids)):
            raise RuntimeError("music creators contain blank or duplicate stable IDs")
        creator_names = [pipeline_recordings.normalized_name(str(row.get("name") or "")) for row in creators.get("creators") or []]
        if not all(creator_names) or len(creator_names) != len(set(creator_names)):
            raise RuntimeError("music creators contain blank or duplicate canonical names")
        creator_id_set = set(creator_ids)
        missing_creator_ids = sorted({
            str(credit.get("creator_id") or "")
            for row in (credits.get("versions") or {}).values()
            for credit in row.get("credits") or []
            if not credit.get("creator_id") or str(credit.get("creator_id")) not in creator_id_set
        })
        if missing_creator_ids:
            raise RuntimeError("music credits reference unknown creators: " + ", ".join(missing_creator_ids[:10]))
        combined_names = sorted({
            str(credit.get("name") or "")
            for row in (credits.get("versions") or {}).values()
            if not row.get("manual")
            for credit in row.get("credits") or []
            if len(pipeline_credits.split_creators(str(credit.get("name") or ""))) > 1
        })
        if combined_names:
            raise RuntimeError("automatic music credits contain combined creator names: " + ", ".join(combined_names[:10]))
        duplicate_credits = []
        for version_id, row in (credits.get("versions") or {}).items():
            keys = [(credit.get("role"), pipeline_recordings.normalized_name(str(credit.get("name") or ""))) for credit in row.get("credits") or []]
            if len(keys) != len(set(keys)):
                duplicate_credits.append(version_id)
        if duplicate_credits:
            raise RuntimeError("music versions contain duplicate creator credits: " + ", ".join(duplicate_credits[:10]))
        unsupported_roles = sorted({
            str(credit.get("role") or "")
            for row in (credits.get("versions") or {}).values()
            for credit in row.get("credits") or []
            if credit.get("role") not in pipeline_common.SUPPORTED_ROLES
        })
        if unsupported_roles:
            raise RuntimeError("unsupported music credit roles: " + ", ".join(unsupported_roles))
        instrumental_lyrics = sorted(
            version_id for version_id in lyrics.get("versions") or {}
            if (recordings.get(version_id) or {}).get("instrumental")
        )
        if instrumental_lyrics:
            raise RuntimeError("instrumental versions must not contain lyrics: " + ", ".join(instrumental_lyrics[:10]))
        if lyrics.get("schema_version") != 2 or timings.get("schema_version") != 2:
            raise RuntimeError("lyrics and lyric timings must use schema version 2")
        documents = lyrics.get("documents") or {}
        all_line_ids = [
            str(line.get("id") or "")
            for document in documents.values()
            for line in document.get("lines") or []
        ]
        if not all(all_line_ids) or len(all_line_ids) != len(set(all_line_ids)):
            raise RuntimeError("canonical lyric documents contain blank or duplicate line IDs")
        for version_id, row in (lyrics.get("versions") or {}).items():
            document_id = str(row.get("document_id") or "")
            document = documents.get(document_id)
            if not document:
                raise RuntimeError(f"lyric version {version_id} references unknown document {document_id}")
            known_lines = {str(line.get("id") or "") for line in document.get("lines") or []}
            line_ids = row.get("line_ids") or ([line.get("id") for line in document.get("lines") or []] if row.get("uses_all_lines") else [])
            if not line_ids or any(str(line_id) not in known_lines for line_id in line_ids):
                raise RuntimeError(f"lyric version {version_id} contains unknown canonical line references")
        for version_id, row in (timings.get("versions") or {}).items():
            lyric_row = (lyrics.get("versions") or {}).get(version_id) or {}
            if row.get("recording_id") != version_id or row.get("lyric_document_id") != lyric_row.get("document_id"):
                raise RuntimeError(f"timing version {version_id} has inconsistent recording or lyric document identity")
            document = documents.get(str(lyric_row.get("document_id") or "")) or {}
            known_lines = set(lyric_row.get("line_ids") or ([line.get("id") for line in document.get("lines") or []] if lyric_row.get("uses_all_lines") else []))
            starts = [int(line.get("start_ms") or 0) for line in row.get("lines") or []]
            if any(value < 0 for value in starts) or any(current < previous for previous, current in zip(starts, starts[1:])):
                raise RuntimeError(f"timing version {version_id} has invalid line order")
            if any(line.get("line_id") and line.get("line_id") not in known_lines for line in row.get("lines") or []):
                raise RuntimeError(f"timing version {version_id} references a lyric line outside its recording sequence")
        unknown_override_refs = sorted({
            str(reference)
            for version_id, row in (overrides.get("versions") or {}).items()
            for reference in [version_id, row.get("parent_version_id"), row.get("lyrics_from")]
            if reference and str(reference) not in known
        })
        if unknown_override_refs:
            raise RuntimeError("music overrides reference unknown versions: " + ", ".join(unknown_override_refs[:10]))
        print(
            "music metadata valid: "
            f"{len(known)} versions, {len((credits.get('versions') or {}))} credited, "
            f"{len((lyrics.get('versions') or {}))} with lyrics, {len((timings.get('versions') or {}))} timed"
        )
        return 0

    refresh = set(args.refresh)
    now = pipeline_common.time.time()
    creators = pipeline_common.read_json(pipeline_common.CREATORS_FILE, {"schema_version": 1, "creators": []})
    credits = pipeline_common.read_json(pipeline_common.CREDITS_FILE, {"schema_version": 1, "versions": {}})
    lyrics = pipeline_common.read_json(pipeline_common.LYRICS_FILE, {"schema_version": 1, "versions": {}})
    timings = pipeline_common.read_json(pipeline_common.TIMINGS_FILE, {"schema_version": 1, "versions": {}})

    inferred_count = 0
    for version_id, recording in recordings.items():
        inferred = pipeline_credits.inferred_remix_credit(recording.get("version_title") or "")
        current = (credits.get("versions") or {}).get(version_id) or {}
        if not inferred or current.get("manual") or any(row.get("role") == "remixer" for row in current.get("credits") or []):
            continue
        if version_id not in credits.setdefault("versions", {}):
            credits["versions"][version_id] = {"credits": [], "source": "recording_title"}
        credits["versions"][version_id].setdefault("credits", []).append(inferred)
        inferred_count += 1

    if args.revalidate_utaten:
        source_urls: dict[str, str] = {}
        for document in (credits, lyrics):
            for version_id, row in (document.get("versions") or {}).items():
                source_url = str(row.get("source_url") or "")
                if source_url.startswith("https://utaten.com/lyric/") and version_id in recordings:
                    source_urls[version_id] = source_url
        mismatches: set[str] = set()
        audit_errors: list[tuple[str, str]] = []
        with pipeline_common.concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 6))) as pool:
            futures = [pool.submit(pipeline_utaten.verify_utaten_source, recordings[version_id], url) for version_id, url in source_urls.items()]
            for future in pipeline_common.concurrent.futures.as_completed(futures):
                version_id, verified, error = future.result()
                if error:
                    audit_errors.append((version_id, error))
                elif not verified:
                    mismatches.add(version_id)
        for version_id in mismatches:
            (credits.get("versions") or {}).pop(version_id, None)
            (lyrics.get("versions") or {}).pop(version_id, None)
            (timings.get("versions") or {}).pop(version_id, None)
            refresh.add(version_id)
            for source_track in recordings[version_id]["tracks"]:
                netease_checked.discard(source_track)
        print(
            f"UtaTen revalidated: {len(source_urls) - len(audit_errors)} checked, "
            f"{len(mismatches)} rejected, {len(audit_errors)} retryable errors"
        )

    if not args.skip_official and not args.lrclib_only and not args.community_only and not args.infer_remixers_only and not args.normalize_lyrics_only:
        from auto_albums import get_official_goods
        official = pipeline_credits.official_credit_rows(get_official_goods(), recordings)
        pipeline_credits.merge_credit_rows(credits, official, refresh)
        print(f"official credits matched: {len(official)} versions")

    errors: list[tuple[str, str]] = []
    errors.extend(("utaten-" + version_id, error) for version_id, error in audit_errors) if args.revalidate_utaten else None
    if not args.utaten_only and not args.lrclib_only and not args.community_only and not args.infer_remixers_only and not args.normalize_lyrics_only:
        existing_credits = credits.get("versions") or {}
        existing_lyrics = lyrics.get("versions") or {}
        target_versions = {
            version_id: row for version_id, row in recordings.items()
            if row["tracks"] and (
                version_id in refresh
                or version_id not in existing_credits
                or (not row["instrumental"] and version_id not in existing_lyrics)
            )
        }
        refresh_tracks = {source_track for version_id, row in target_versions.items() if version_id in refresh for source_track in row["tracks"]}
        targets = sorted({source_track for row in target_versions.values() for source_track in row["tracks"]
                          if source_track in refresh_tracks or source_track not in netease_checked or now - float(netease_checked_at.get(source_track, 0)) >= 86400},
                         key=lambda track: float(netease_checked_at.get(track, 0)))
        if args.limit:
            targets = targets[: max(0, args.limit)]
        fetched: dict[str, dict[str, pipeline_common.Any] | None] = {}
        with pipeline_common.concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            futures = [pool.submit(pipeline_sources.fetch_track, source_track) for source_track in targets]
            for index, future in enumerate(pipeline_common.concurrent.futures.as_completed(futures), 1):
                source_track, payload, error = future.result()
                fetched[source_track] = payload
                netease_checked_at[source_track] = pipeline_common.time.time()
                if error:
                    errors.append((source_track, error))
                else:
                    netease_checked.add(source_track)
                if index % 100 == 0 or index == len(futures):
                    print(f"recording metadata fetched: {index}/{len(futures)}", flush=True)
        creators, credits, lyrics, timings = pipeline_documents.build_documents(
            target_versions, fetched, refresh, (creators, credits, lyrics, timings)
        )

    if args.utaten or args.utaten_only:
        now = pipeline_common.time.time()
        target_utaten = [
            row for version_id, row in recordings.items()
            if not row["instrumental"]
            and (version_id in refresh or version_id not in utaten_checked or now - float(utaten_checked_at.get(version_id, 0)) >= 24 * 60 * 60)
            and (version_id not in (lyrics.get("versions") or {}) or version_id not in (credits.get("versions") or {}))
        ]
        # Newly discovered recordings come first; older missing metadata rotates
        # by its last attempt rather than permanently caching an absent lyric.
        target_utaten.sort(key=lambda row: (row['version_id'] in utaten_checked, float(utaten_checked_at.get(row['version_id'], 0))))
        if args.limit:
            target_utaten = target_utaten[: max(0, args.limit)]
        results: dict[str, dict[str, pipeline_common.Any] | None] = {}
        with pipeline_common.concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 6))) as pool:
            futures = [pool.submit(pipeline_utaten.fetch_utaten, row) for row in target_utaten]
            for index, future in enumerate(pipeline_common.concurrent.futures.as_completed(futures), 1):
                version_id, payload, error = future.result()
                results[version_id] = payload
                if error:
                    errors.append((version_id, error))
                else:
                    utaten_checked.add(version_id)
                    utaten_checked_at[version_id] = now
                if index % 50 == 0 or index == len(futures):
                    print(f"UtaTen checked: {index}/{len(futures)}", flush=True)
        creators, credits, lyrics, timings = pipeline_documents.apply_utaten_results(
            recordings, results, creators, credits, lyrics, timings, refresh
        )

    if args.community or args.community_only:
        try:
            community_credits = pipeline_credits.parse_oshikatsu_credits(pipeline_sources.fetch_text(pipeline_common.OSHIKATSU_URL), recordings)
            pipeline_credits.merge_credit_rows(credits, community_credits, refresh)
            print(f"community catalog credits matched: {len(community_credits)} versions")
        except (pipeline_common.urllib.error.URLError, TimeoutError) as error:
            errors.append((pipeline_common.OSHIKATSU_URL, str(error)))

        try:
            category_pages = pipeline_sources.wiki_song_pages()
        except (pipeline_common.urllib.error.URLError, TimeoutError, pipeline_common.json.JSONDecodeError) as error:
            category_pages = []
            errors.append((pipeline_common.UMAMUSU_WIKI_CATEGORY, str(error)))
        pending_pages = [row for row in category_pages if int(row.get("pageid") or 0) not in umamusu_wiki_checked
                         or now - float(wiki_checked_at.get(str(row.get('pageid')), 0)) >= 7 * 86400]
        if args.limit:
            pending_pages = pending_pages[: max(0, args.limit)]
        fetched_pages, wiki_errors = pipeline_sources.wiki_page_wikitext([int(row["pageid"]) for row in pending_pages])
        errors.extend(("umamusu-wiki-" + error.split(":", 1)[0], error) for error in wiki_errors)
        original_versions: dict[str, str] = {}
        duplicate_titles: set[str] = set()
        for song in songs.get("songs") or []:
            key = pipeline_recordings.folded_title(str(song.get("title") or ""))
            version_id = str(song.get("original_version_id") or "")
            if not key or not version_id:
                continue
            if key in original_versions and original_versions[key] != version_id:
                duplicate_titles.add(key)
            else:
                original_versions[key] = version_id
        for key in duplicate_titles:
            original_versions.pop(key, None)
        lyric_versions = lyrics.setdefault("versions", {})
        accepted = 0
        for page in fetched_pages:
            page_id = int(page.get("pageid") or 0)
            umamusu_wiki_checked.add(page_id)
            wiki_checked_at[str(page_id)] = now
            version_id, lines = pipeline_lyrics.parse_wiki_song(page, original_versions)
            if not version_id or not lines or (version_id in lyric_versions and version_id not in refresh):
                continue
            lyric_versions[version_id] = {
                "language": "ja",
                "lines": lines,
                "source": "umamusu_wiki",
                "source_url": "https://umamusu.wiki/" + pipeline_common.urllib.parse.quote(str(page.get("title") or "").replace(" ", "_")),
            }
            accepted += 1
        print(f"Umamusume Wiki checked: {len(fetched_pages)}, accepted lyrics: {accepted}")

    if args.lrclib or args.lrclib_only:
        lyric_versions = lyrics.get("versions") or {}
        timing_versions = timings.get("versions") or {}
        target_lrclib = [
            (row, pipeline_lyrics.lyric_document_lines(lyrics, version_id))
            for version_id, row in recordings.items()
            if not row["instrumental"]
            and (version_id in refresh or version_id not in lrclib_checked or now - float(lrclib_checked_at.get(version_id, 0)) >= 7 * 86400)
            and version_id in lyric_versions
            and (version_id not in timing_versions or version_id in refresh)
        ]
        if args.limit:
            target_lrclib = target_lrclib[: max(0, args.limit)]
        results: dict[str, dict[str, pipeline_common.Any] | None] = {}
        with pipeline_common.concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 6))) as pool:
            futures = [pool.submit(pipeline_timings.fetch_lrclib_timing, row, lines) for row, lines in target_lrclib]
            for index, future in enumerate(pipeline_common.concurrent.futures.as_completed(futures), 1):
                version_id, payload, error = future.result()
                results[version_id] = payload
                if error:
                    errors.append((version_id, error))
                else:
                    lrclib_checked.add(version_id)
                    lrclib_checked_at[version_id] = now
                if index % 50 == 0 or index == len(futures):
                    print(f"LRCLIB checked: {index}/{len(futures)}", flush=True)
        pipeline_timings.apply_lrclib_results(results, timings, refresh)

    pipeline_credits.normalize_automatic_credit_rows(credits)
    creators["creators"] = pipeline_credits.creator_rows(credits, creators)
    for row in (credits.get("versions") or {}).values():
        if row.get("source") == "oshikatsu_techo_catalog":
            row["source_url"] = pipeline_common.OSHIKATSU_URL
    for version_id, recording in recordings.items():
        if recording["instrumental"]:
            (lyrics.get("versions") or {}).pop(version_id, None)
            (timings.get("versions") or {}).pop(version_id, None)
    lyrics, timings = pipeline_lyrics.canonicalize_lyrics(recordings, lyrics, timings)
    pipeline_common.write_json(pipeline_common.CREATORS_FILE, creators)
    pipeline_common.write_json(pipeline_common.CREDITS_FILE, credits)
    pipeline_common.write_json(pipeline_common.LYRICS_FILE, lyrics)
    pipeline_common.write_json(pipeline_common.TIMINGS_FILE, timings)
    pipeline_common.write_json(pipeline_common.SOURCE_STATE_FILE, {
        "schema_version": 1,
        "netease_checked": sorted(netease_checked),
        "netease_checked_at": netease_checked_at,
        "utaten_checked": sorted(utaten_checked),
        "utaten_checked_at": utaten_checked_at,
        "lrclib_checked": sorted(lrclib_checked),
        "lrclib_checked_at": lrclib_checked_at,
        "umamusu_wiki_checked_at": wiki_checked_at,
        "umamusu_wiki_checked": sorted(umamusu_wiki_checked),
    })
    print(
        f"music metadata written: {len(credits['versions'])} credited versions, "
        f"{len(lyrics['versions'])} lyric versions, {len(creators['creators'])} creators, "
        f"{inferred_count} title-inferred remixers added"
    )
    if errors:
        print(f"metadata requests failed: {len(errors)} (rerun retries only unresolved network errors)")
        for identifier, error in errors[:5]:
            print('metadata source unavailable: ' + str(identifier)[:100] + ': ' + str(error).replace('\n', ' ')[:200])
    return 1 if errors else 0
