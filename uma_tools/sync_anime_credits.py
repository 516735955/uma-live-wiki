"""Collect public official ending signatures with bounded, temporary local OCR."""
import argparse
import collections
import csv
import datetime as dt
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
from PIL import Image, ImageOps, ImageStat
from anime_credit_text import staff_text_rows
from anime_labels import ROLES, person_name_key
from knowledge_io import ROOT, fetch, read_json, read_window, unique_names, write_json
from sync_anime_sources import publish_episode, source
from public_video import yt_command
from video_fragment import range_source, select_video

DATA = ROOT / 'data/anime'
STATE = ROOT / 'data/auto_update/anime_credits.json'
EVIDENCE = DATA / 'credit_evidence'
TEMP = ROOT / 'data/auto_update/credit_tmp'
MODEL = ROOT / 'data/auto_update/tessdata_best/jpn.traineddata'


def command(arguments, timeout=90):
    return subprocess.run(arguments, check=True, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)


def ocr_image(frame, run=command):
    if not MODEL.exists():
        data = fetch('https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/jpn.traineddata', binary=True)
        MODEL.parent.mkdir(parents=True, exist_ok=True)
        temporary = MODEL.with_suffix('.tmp')
        try:
            temporary.write_bytes(data); temporary.replace(MODEL)
        finally:
            temporary.unlink(missing_ok=True)
    frame = Path(frame).resolve()
    processed = frame.with_suffix('.ocr.png')
    try:
        with Image.open(frame) as original:
            image = ImageOps.autocontrast(ImageOps.grayscale(original))
            if ImageStat.Stat(image).mean[0] < 128:
                image = ImageOps.invert(image)
            image.resize((image.width * 2, image.height * 2)).save(processed)
        # A custom language-model directory has no bundled tsv config file.
        # Request TSV explicitly; otherwise Tesseract silently emits plain text.
        result = run(['tesseract', str(processed), 'stdout', '--tessdata-dir', str(MODEL.parent), '-l', 'jpn', '--psm', '11', '-c', 'tessedit_create_tsv=1'], timeout=15)
    finally:
        processed.unlink(missing_ok=True)
    if not result.stdout.startswith('level\tpage_num\t'):
        raise ValueError('Tesseract did not emit its required TSV fields')
    lines = collections.OrderedDict()
    for row in csv.DictReader(io.StringIO(result.stdout), delimiter='\t'):
        if not row.get('text', '').strip() or float(row.get('conf', -1)) < 0:
            continue
        key = (row['block_num'], row['par_num'], row['line_num'])
        line = lines.setdefault(key, {'words':[], 'confidence':[], 'left':int(row['left']), 'top':int(row['top']), 'bottom':0})
        line['words'].append((int(row['left']), int(row['width']), row['text'].strip()))
        line['bottom'] = max(line['bottom'], int(row['top']) + int(row['height']))
        line['confidence'].append(float(row['conf']))
    result = []
    for line in lines.values():
        words = sorted(line['words'])
        widths = sorted(width for _, width, _ in words)
        threshold = widths[len(widths)//2] * 1.7
        text, right = '', None
        for left, width, word in words:
            text += ('  ' if right is not None and left - right > threshold else '') + word
            right = left + width
        result.append({key:value for key,value in line.items() if key not in ('words','confidence')} |
                      {'text':text, 'confidence':sum(line['confidence']) / len(line['confidence']), 'column':int(line['left'] > image.width)})
    return result


def frame_signatures(lines, roles, people, organizations, characters, voices):
    accepted = [line['text'] for line in lines if line['confidence'] >= 85]
    if lines and all('top' in line for line in lines):
        known = {re.sub(r'\s+', '', role):role for role in roles}
        staff = []
        for column in (0, 1):
            active, bottom, height = '', 0, 1
            for line in sorted((line for line in lines if line['column']==column),key=lambda row:(row['top'],row['left'])):
                role = known.get(re.sub(r'\s+', '', line['text']))
                if role and line['confidence'] >= 85:
                    active, bottom, height = role, line['bottom'], max(1,line['bottom']-line['top'])
                elif active:
                    if line['top'] - bottom > height * 2.2:
                        active = ''
                    elif line['confidence'] < 85:
                        # An unreadable name is skipped. A compact heading ends
                        # the role group, so its following names cannot inherit
                        # a previously recognized, unrelated role.
                        if line['bottom'] - line['top'] <= height * 1.25:
                            active = ''
                        else:
                            bottom = line['bottom']
                    else:
                        staff.append({'title':active, 'name':line['text']})
                        bottom = line['bottom']
    else:
        staff = staff_text_rows('\n'.join(accepted), roles)
    result = []
    for row in staff:
        for name in re.split(r'[、，]|\s{2,}', row['name']):
            key = person_name_key(name)
            if not key or key in {person_name_key(role) for role in roles} or not re.fullmatch(r'[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff・･ .&’\'-]{2,40}', name):
                continue
            kind = 'person' if key in people else 'organization' if key in organizations else 'unresolved'
            result.append({'kind':'staff','title':row['title'],'name':name.strip(), 'entity_type':kind})
    # Role and voice must both occur on a single high-confidence line. A voice
    # name alone never creates a character appearance or a guessed role.
    for line in accepted:
        key = person_name_key(line)
        cast = [(name, row) for name, row in characters.items() if name and name in key]
        actors = [(name, row) for name, row in voices.items() if name and name in key]
        if len({row['id'] for _, row in cast}) == 1 and len({row['id'] for _, row in actors}) == 1:
            result.append({'kind':'cast','title':cast[0][1]['ja'],'name':actors[0][1]['identity']['ja']})
    return result


def consensus(observations):
    counts, first = collections.Counter(), {}
    for time_position, frame, rows in observations:
        seen = set()
        for row in rows:
            key = (row['kind'], person_name_key(row['title']), person_name_key(row['name']))
            if key in seen:
                continue
            seen.add(key); counts[key] += 1
            first.setdefault(key, (time_position, frame, row))
    return [first[key] for key, count in counts.items() if count >= 2]


def extract(resource, directory, run=command, recognize=ocr_image):
    started = time.monotonic()
    metadata = json.loads(run(yt_command(['--skip-download','--no-playlist','--no-warnings','--socket-timeout','12','--dump-single-json',resource['url']]), timeout=60).stdout)
    duration = float(metadata.get('duration') or 0)
    if duration <= 15 or metadata.get('is_live') or metadata.get('availability') in ('private','needs_auth','subscriber_only','premium_only'):
        raise ValueError('official public clip metadata is unavailable')
    start, end = max(0, duration - min(170,max(24,duration*.25))), max(0, duration - 4)
    video = select_video(metadata,end-start)
    with range_source(video['url'],{**metadata.get('http_headers',{}),**video.get('http_headers',{})}) as local:
        run(['ffmpeg','-nostdin','-v','error','-rw_timeout','15000000','-ss',str(start),'-i',local,
             '-t',str(end-start),'-an','-vf','fps=1/2,scale=-2:720','-frames:v','90',
             str(directory/'frame-%03d.png')],timeout=240)
    observations = []
    for index, frame in enumerate(sorted(directory.glob('frame-*.png'))):
        if time.monotonic() - started >= 480:
            break
        try:
            observations.append((start + index * 2, frame, recognize(frame)))
        except subprocess.TimeoutExpired:
            continue
    return observations


def cleanup_interrupted():
    TEMP.mkdir(parents=True, exist_ok=True)
    for directory in TEMP.glob('job-*'):
        if directory.is_dir() and time.time() - directory.stat().st_mtime > 3600:
            shutil.rmtree(directory)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--limit', type=int, default=2)
    args = parser.parse_args()
    names = ('works','units','relations','staff','people','source_registry','watch_resources','asset_sources','ending_credits')
    documents = {name:read_json(DATA / (name+'.json')) for name in names}
    state = read_json(STATE, {'attempted_at':{}})
    attempts = state.setdefault('attempted_at', {})
    complete = {(row['work_id'],int(row['number'])) for row in documents['ending_credits']['episodes']
                if row.get('staff_status') == 'complete' and row.get('cast_status') == 'complete'}
    known_units = {f"{series['work_id']}-e{int(number):02d}":(series['work_id'],int(number))
                   for series in documents['units']['series'] for number in series.get('published_numbers',range(1,int(series.get('released_count',0))+1))}
    jobs = [row for row in documents['watch_resources']['resources'] if row.get('authority') == 'official'
            and row.get('content_type') == 'full_episode' and row.get('status') == 'active'
            and row.get('scope',{}).get('id') in known_units and known_units[row['scope']['id']] not in complete
            and time.time() - attempts.get(row['scope']['id'],0) >= 86400]
    jobs.sort(key=lambda row:attempts.get(row['scope']['id'],0))
    if jobs and any(not shutil.which(tool) for tool in ('yt-dlp','ffmpeg','tesseract')):
        raise RuntimeError('ending collector requires yt-dlp, ffmpeg and tesseract')
    roles = set(ROLES) | {row['role'] for row in documents['staff']['credits']}
    people = {person_name_key(row['name']) for row in documents['people']['people']}
    organizations = {person_name_key(row.get('organization','')) for row in documents['staff']['credits'] if row.get('organization')}
    characters = unique_names(read_window(ROOT / 'data/character_index_data.js'), lambda row:[person_name_key(row.get('ja',''))])
    voices = unique_names(read_json(ROOT / 'data/voice_actor_profiles.json')['voice_actors'],lambda row:[person_name_key(row['identity'].get('ja',''))])
    cleanup_interrupted()
    failures = []
    for resource in jobs[:args.limit]:
        uid = resource['scope']['id']; work_id, number = known_units[uid]
        attempts[uid] = time.time()
        try:
            with tempfile.TemporaryDirectory(prefix='job-',dir=TEMP) as directory:
                observations = extract(resource, Path(directory))
                signatures = consensus([(position,frame,frame_signatures(lines,roles,people,organizations,characters,voices))
                                        for position,frame,lines in observations])
                if not signatures:
                    raise ValueError('ending OCR returned no repeated high-confidence signatures')
                staff, cast, frames = [], [], {}
                for position, frame, signature in signatures:
                    key = int(position * 100)
                    output = EVIDENCE / (uid + '-' + str(key).zfill(6) + '.webp')
                    if not args.dry_run and key not in frames:
                        EVIDENCE.mkdir(parents=True,exist_ok=True)
                        with Image.open(frame) as image:
                            image.save(output,'WEBP',quality=92)
                    frames[key] = {'time':position,'image':'/'+str(output.relative_to(ROOT)).replace('\\','/'),'url':resource['url']}
                    row = {**signature,'source_time':position}
                    (cast if row.pop('kind') == 'cast' else staff).append(row)
                evidence = source(documents,'official-auto-ending-'+uid,resource['url'],'公开官方片尾，本地 OCR 重复核对')['id']
                detail = next(series for series in documents['units']['series'] if series['work_id']==work_id).get('details',{}).get(str(number),{})
                publish_episode({'work_id':work_id,'number':number,'title_ja':detail.get('title_ja') or uid,
                                 'source_url':resource['url'],'staff':staff,'cast':cast},documents,characters,voices,save_image=lambda asset:None)
                previous = next((row for row in documents['ending_credits']['episodes'] if row.get('work_id')==work_id and row.get('number')==number), None)
                observed = {'work_id':work_id,'number':number,'url':resource['url'],'source_ref':evidence,
                            'staff_status':'partial','cast_status':'partial','staff':staff,'cast':[[row['title'],row['name']] for row in cast],
                            'evidence_frames':list(frames.values()),'automatic_ocr':True}
                if previous and not previous.get('automatic_ocr'):
                    # Curated signatures are already imported; automatic evidence adds facts without replacing them.
                    previous.setdefault('automatic_evidence',[]).append({'source_ref':evidence,'frames':list(frames.values())})
                elif previous:
                    previous.update(observed)
                else:
                    documents['ending_credits']['episodes'].append(observed)
        except (OSError,ValueError,subprocess.SubprocessError) as error:
            failures.append(uid)
            reason = error.stderr if isinstance(error,subprocess.CalledProcessError) else str(error)
            reason = re.sub(r'https?://\S+','<public source>',reason or '')[-350:]
            print('ending source retryable:',uid,type(error).__name__,reason,flush=True)
    if not args.dry_run:
        for name in names:
            write_json(DATA / (name+'.json'),documents[name])
        write_json(STATE,state)
    print('ending collector: %d selected, %d retryable; temporary media removed' % (min(len(jobs),args.limit),len(failures)))
    if TEMP.exists() and not any(TEMP.iterdir()):
        TEMP.rmdir()
    return bool(failures)


if __name__ == '__main__':
    raise SystemExit(main())
