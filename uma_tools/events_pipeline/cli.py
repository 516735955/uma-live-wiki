"""Cli responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import build as pipeline_build
from . import common as pipeline_common
from . import profiles as pipeline_profiles
from . import program_discovery as pipeline_program_discovery
from . import program_merge as pipeline_program_merge
from catalog_publication import publish_catalog


def main(argv: list[str] | None = None) -> int:
    parser = pipeline_common.argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--refresh-programs", action="store_true", help="refresh regular, character, and special programs from official sources")
    mode.add_argument("--refresh-profiles", action="store_true", help="refresh voice-actor biographical fields and cited profile links")
    mode.add_argument("--refresh-all", action="store_true", help="refresh programs and voice-actor profiles, then rebuild all indexes")
    mode.add_argument("--music-only", action="store_true", help="rebuild music catalogs while preserving curated event and profile documents")
    mode.add_argument("--check", action="store_true", help="validate sources and committed generated files without writing")
    parser.add_argument("--dry-run", action="store_true", help="run network discovery and validation without changing source or generated catalogs")
    parser.add_argument("--report", type=pipeline_common.Path, default=pipeline_common.PROGRAM_REFRESH_REPORT, help="write the ignored official-program refresh report here")
    args = parser.parse_args(argv)
    if args.dry_run and not (args.refresh_programs or args.refresh_all or args.refresh_profiles):
        parser.error("--dry-run requires a refresh mode")
    refreshed_programs = None
    program_report = None
    refreshed_details = None
    profile_errors = []
    if args.refresh_programs or args.refresh_all:
        existing_programs = pipeline_common.read_json(pipeline_common.EVENTS_DIR / "official_programs.json")
        discovered_programs = pipeline_program_discovery.refresh_programs()
        refreshed_programs, program_report = pipeline_program_merge.apply_additive_program_refresh(existing_programs, discovered_programs)
    if args.refresh_profiles or args.refresh_all:
        discovered_details = pipeline_profiles.refresh_voice_actor_details(persist=not args.dry_run)
        profile_errors = discovered_details.get('coverage', {}).get('source_errors', [])
        existing_details = pipeline_common.read_json(pipeline_common.VOICE_DETAILS_FILE) if pipeline_common.VOICE_DETAILS_FILE.exists() else {"records": []}
        refreshed_details = pipeline_profiles.apply_additive_voice_detail_refresh(existing_details, discovered_details)
    built = pipeline_build.build_music_only() if args.music_only else pipeline_build.build(refreshed_programs, refreshed_details)
    if args.check:
        mismatches = []
        for key, path in pipeline_common.OUTPUT_FILES.items():
            if not path.exists() or pipeline_common.comparable(pipeline_common.read_json(path)) != pipeline_common.comparable(built[key]):
                mismatches.append(str(path.relative_to(pipeline_common.ROOT)))
        if mismatches:
            print("generated files are stale: " + ", ".join(mismatches), file=pipeline_common.sys.stderr)
            return 1
        print(f"event data valid: {len(built['catalog']['events'])} events, {len(built['profiles']['voice_actors'])} voice actors")
        return 0
    if program_report is not None:
        program_report["dry_run"] = bool(args.dry_run)
        pipeline_common.atomic_json(args.report, program_report)
    if args.dry_run:
        if program_report is not None:
            counts = program_report["counts"]
            print(
                "official program dry run: "
                f"{counts['added']} new, {counts['filled']} filled, "
                f"{counts['conflicts']} conflicts, {counts['retained_missing']} retained"
            )
            print(f"report written: {args.report}")
        if refreshed_details is not None:
            print(f"voice actor profile dry run: {len(refreshed_details['records'])} records")
        return 0
    if refreshed_programs is not None:
        pipeline_common.atomic_json(pipeline_common.EVENTS_DIR / "official_programs.json", refreshed_programs)
        print(f"official programs refreshed: {len(refreshed_programs['programs'])}")
    if refreshed_details is not None:
        pipeline_common.atomic_json(pipeline_common.VOICE_DETAILS_FILE, refreshed_details)
        print(f"voice actor details refreshed: {len(refreshed_details['records'])}")
    publish_catalog(pipeline_common.OUTPUT_FILES, built, pipeline_common.atomic_json)
    coverage = built["catalog"]["coverage"]
    if args.music_only:
        print(
            "music catalogs written: "
            f"{built['songs']['coverage']['songs']} songs, {built['creators']['coverage']['creators']} creators; "
            "curated events and profiles preserved"
        )
    else:
        print(f"event data written: {coverage['events']} events, {coverage['official_programs']} official programs, {len(built['profiles']['voice_actors'])} voice actors")
        print("curated live source integrity: " + ", ".join(f"{name}={info['sha256'][:12]}" for name, info in built["catalog"]["source_integrity"].items()))
    errors = (refreshed_programs or {}).get('coverage', {}).get('source_errors', []) + profile_errors
    rechecks = (refreshed_programs or {}).get('coverage', {}).get('metadata_recheck_pending', [])
    if rechecks:
        print(f"retained archived metadata; {len(rechecks)} existing video rechecks remain queued")
    if errors:
        print('source updates partially failed: ' + '; '.join(errors), file=pipeline_common.sys.stderr)
        return 1
    return 0
