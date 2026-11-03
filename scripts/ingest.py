"""Charybdis ingest: upload local tracks to S3 and keep the DynamoDB library in sync.

Idempotent and resumable: a track already in DynamoDB is never uploaded again.
Tags are read from the LOCAL disk only. Never read music/ back from S3 in bulk: Glacier Instant
Retrieval bills $0.03/GB retrieved.

Usage (Anaconda base python; set CHARYBDIS_LIBRARY_ROOT or pass --root <path-to-itunes>\iTunes Media\Music):
    python scripts/ingest.py playlists --export scratch/itunes-export.json [--dry-run]
    python scripts/ingest.py recent --days 90 [--dry-run]
    python scripts/ingest.py reset
"""
import argparse
import hashlib
import io
import json
import os
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from decimal import Decimal
from pathlib import Path

import boto3
from boto3.dynamodb.conditions import Key
from boto3.s3.transfer import TransferConfig
from mutagen import File as MutagenFile
from mutagen.id3 import ID3, ID3NoHeaderError
from mutagen.mp4 import MP4
from PIL import Image

STACK = 'charybdis'
DEFAULT_ROOT = os.environ.get('CHARYBDIS_LIBRARY_ROOT')  # e.g. <path-to-itunes>\iTunes Media\Music
ART_SIZE = 600
WORKERS = 4
CONTENT_TYPES = {'.m4a': 'audio/mp4', '.mp3': 'audio/mpeg'}
TRANSFER = TransferConfig(max_concurrency=4)


def short_id(text: str, length: int) -> str:
    return hashlib.sha1(text.encode('utf-8')).hexdigest()[:length]


def first(value, default=''):
    if isinstance(value, (list, tuple)):
        value = value[0] if value else default
    return str(value) if value is not None else default


def number_pair(value):
    """trkn/disk style (n, total) tuples or '3/12' strings -> n (0 if unknown)."""
    value = value[0] if isinstance(value, list) and value else value
    if isinstance(value, tuple):
        return int(value[0] or 0)
    try:
        return int(str(value).split('/')[0])
    except (ValueError, TypeError):
        return 0


def resolve(path, root: Path) -> Path:
    """On-disk casing, so ids are identical whether a path came from a directory scan or from iTunes."""
    return Path(os.path.realpath(path))


def track_id(path: Path, root: Path) -> str:
    return short_id(path.relative_to(root).as_posix(), 16)


def read_track(path: Path, root: Path):
    """Return (metadata dict, cover bytes or None), or None if the file is unusable."""
    ext = path.suffix.lower()
    audio = MutagenFile(path)
    if audio is None:
        return None
    meta = {'ext': ext, 'durationSec': round(audio.info.length, 1), 'sampleRate': int(audio.info.sample_rate)}
    cover = None

    if ext == '.m4a':
        tags = MP4(path).tags or {}
        meta.update(
            title=first(tags.get('\xa9nam')), artist=first(tags.get('\xa9ART')),
            album=first(tags.get('\xa9alb')), albumArtist=first(tags.get('aART')),
            trackNo=number_pair(tags.get('trkn')), discNo=number_pair(tags.get('disk')),
            year=first(tags.get('\xa9day'))[:4], genre=first(tags.get('\xa9gen')),
            codec='alac' if audio.info.codec == 'alac' else 'aac',
            bitrate=int(audio.info.bitrate), bitDepth=int(getattr(audio.info, 'bits_per_sample', 0) or 0),
        )
        covers = tags.get('covr')
        cover = bytes(covers[0]) if covers else None
    else:
        try:
            id3 = ID3(path)
        except ID3NoHeaderError:
            id3 = ID3()
        text = lambda frame: first(id3[frame].text) if frame in id3 else ''
        meta.update(
            title=text('TIT2'), artist=text('TPE1'), album=text('TALB'), albumArtist=text('TPE2'),
            trackNo=number_pair(text('TRCK')), discNo=number_pair(text('TPOS')), year=text('TDRC')[:4],
            genre=text('TCON'), codec='mp3', bitrate=int(audio.info.bitrate), bitDepth=0,
        )
        pics = id3.getall('APIC')
        cover = pics[0].data if pics else None

    meta['title'] = meta['title'] or path.stem
    meta['album'] = meta['album'] or path.parent.name or 'Unknown Album'
    meta['id'] = track_id(path, root)
    meta['albumId'] = short_id(path.parent.relative_to(root).as_posix(), 12)
    meta['albumArtist'] = meta['albumArtist'] or meta['artist']
    return meta, cover


def cover_to_jpeg(data: bytes) -> bytes:
    image = Image.open(io.BytesIO(data)).convert('RGB')
    image.thumbnail((ART_SIZE, ART_SIZE))
    out = io.BytesIO()
    image.save(out, 'JPEG', quality=85, optimize=True)
    return out.getvalue()


def to_dynamo(value):
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: to_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_dynamo(v) for v in value]
    return value


class Library:
    def __init__(self):
        outputs = {o['OutputKey']: o['OutputValue']
                   for o in boto3.client('cloudformation').describe_stacks(StackName=STACK)['Stacks'][0]['Outputs']}
        self.bucket = outputs['BucketName']
        self.s3 = boto3.client('s3')
        self.table = boto3.resource('dynamodb').Table(outputs['LibraryTableName'])

    def items(self, entity):
        out, kwargs = [], {'KeyConditionExpression': Key('pk').eq(entity)}
        while True:
            page = self.table.query(**kwargs)
            out.extend(page['Items'])
            if 'LastEvaluatedKey' not in page:
                return out
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def put_all(self, entity, items):
        with self.table.batch_writer() as batch:
            for item in items:
                batch.put_item(Item=to_dynamo({'pk': entity, 'sk': item['id'], **item}))

    def delete_items(self, entity, ids):
        with self.table.batch_writer() as batch:
            for sk in ids:
                batch.delete_item(Key={'pk': entity, 'sk': sk})


def rebuild_albums(tracks: dict, art_keys: dict) -> list:
    by_album = defaultdict(list)
    for t in tracks.values():
        by_album[t['albumId']].append(t)
    albums = []
    for album_id, group in by_album.items():
        group.sort(key=lambda t: (t['discNo'], t['trackNo'], t['title']))
        head = group[0]
        albums.append({
            'id': album_id, 'title': head['album'], 'artist': head['albumArtist'], 'year': head['year'],
            'trackIds': [t['id'] for t in group], 'artKey': art_keys.get(album_id),
        })
    return albums


def upload_one(lib: Library, path: Path, root: Path):
    result = read_track(path, root)
    if result is None:
        raise ValueError('unreadable audio file')
    meta, cover = result
    key = f"music/{meta['id']}{meta['ext']}"
    lib.s3.upload_file(
        str(path), lib.bucket, key,
        ExtraArgs={'ContentType': CONTENT_TYPES[meta['ext']], 'StorageClass': 'GLACIER_IR'}, Config=TRANSFER,
    )
    meta['key'] = key
    return meta, cover


def sync_tracks(lib: Library, paths, root: Path, dry_run: bool):
    """Upload every path not already in the library. Returns the full {id: track} map."""
    tracks = {t['sk']: {k: v for k, v in t.items() if k not in ('pk', 'sk')} for t in lib.items('TRACK')}
    art_keys = {a['id']: a.get('artKey') for a in lib.items('ALBUM')}

    unique = {}
    for p in paths:
        unique[track_id(p, root)] = p
    todo = [(tid, p) for tid, p in unique.items() if tid not in tracks]
    todo_mb = sum(p.stat().st_size for _, p in todo) / 1e6
    print(f'{len(unique)} requested, {len(unique) - len(todo)} already uploaded, '
          f'{len(todo)} to upload ({todo_mb / 1000:.1f} GB)')
    if dry_run or not todo:
        return tracks

    failures, done_mb, started = [], 0.0, time.time()

    def flush_albums():
        lib.put_all('ALBUM', rebuild_albums(tracks, art_keys))

    try:
        with ThreadPoolExecutor(WORKERS) as pool:
            futures = {pool.submit(upload_one, lib, p, root): p for _, p in todo}
            for n, fut in enumerate(as_completed(futures), 1):
                path = futures[fut]
                try:
                    meta, cover = fut.result()
                except Exception as exc:
                    failures.append((path, exc))
                    print(f'  FAILED {path.name}: {exc}')
                    continue
                if cover and not art_keys.get(meta['albumId']):
                    try:
                        art_key = f"art/{meta['albumId']}.jpg"
                        lib.s3.put_object(
                            Bucket=lib.bucket, Key=art_key, Body=cover_to_jpeg(cover),
                            ContentType='image/jpeg', CacheControl='private, max-age=86400',
                        )
                        art_keys[meta['albumId']] = art_key
                    except Exception as exc:
                        print(f'  (no art for {meta["album"]}: {exc})')
                lib.table.put_item(Item=to_dynamo({'pk': 'TRACK', 'sk': meta['id'], **meta}))
                tracks[meta['id']] = meta
                done_mb += path.stat().st_size / 1e6
                if n % 25 == 0 or n == len(todo):
                    rate = done_mb / max(time.time() - started, 1)
                    eta = (todo_mb - done_mb) / rate / 60 if rate else 0
                    print(f'  [{n}/{len(todo)}] {done_mb / 1000:.1f}/{todo_mb / 1000:.1f} GB  '
                          f'{rate:.1f} MB/s  ~{eta:.0f} min left', flush=True)
                if n % 250 == 0:
                    flush_albums()
    finally:
        flush_albums()

    if failures:
        print(f'{len(failures)} files failed; re-run the same command to retry them.')
    return tracks


def import_playlists(lib: Library, export: list, root: Path, tracks: dict):
    keep, seen = [], set()
    for pl in export:
        ids = []
        for t in pl['tracks']:
            if not t['location']:
                continue
            tid = track_id(resolve(t['location'], root), root)
            if tid in tracks:
                ids.append(tid)
        if not ids:
            print(f"  skipped playlist {pl['name']!r}: no playable local tracks")
            continue
        sk = short_id('itunes:' + pl['name'], 12)
        if sk in seen:
            print(f"  skipped duplicate playlist name {pl['name']!r}")
            continue
        seen.add(sk)
        keep.append({'id': sk, 'name': pl['name'], 'trackIds': ids, 'source': 'itunes'})
    lib.put_all('PLAYLIST', keep)
    stale = [p['sk'] for p in lib.items('PLAYLIST') if p.get('source') == 'itunes' and p['sk'] not in seen]
    lib.delete_items('PLAYLIST', stale)
    print(f'Wrote {len(keep)} playlists ({sum(len(p["trackIds"]) for p in keep)} entries); removed {len(stale)} stale.')


def cmd_playlists(args, lib, root):
    export = json.load(open(args.export, encoding='utf-8-sig'))
    paths = [resolve(t['location'], root) for pl in export for t in pl['tracks'] if t['location']]
    missing = [p for p in paths if not p.exists()]
    if missing:
        sys.exit(f'{len(missing)} playlist files are missing on disk, e.g. {missing[0]}')
    tracks = sync_tracks(lib, paths, root, args.dry_run)
    if not args.dry_run:
        import_playlists(lib, export, root, tracks)


def cmd_recent(args, lib, root):
    cutoff = time.time() - args.days * 86400
    paths = [resolve(p, root) for p in root.rglob('*')
             if p.suffix.lower() in CONTENT_TYPES and p.stat().st_mtime >= cutoff]
    print(f'{len(paths)} files modified in the last {args.days} days')
    sync_tracks(lib, paths, root, args.dry_run)


def cmd_reset(_args, lib, _root):
    for prefix in ('music/', 'art/'):
        for page in lib.s3.get_paginator('list_objects_v2').paginate(Bucket=lib.bucket, Prefix=prefix):
            keys = [{'Key': o['Key']} for o in page.get('Contents', [])]
            if keys:
                lib.s3.delete_objects(Bucket=lib.bucket, Delete={'Objects': keys})
    for entity in ('TRACK', 'ALBUM', 'PLAYLIST'):
        lib.delete_items(entity, [i['sk'] for i in lib.items(entity)])
    print('Reset: cleared music/, art/ and all library items.')


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default=DEFAULT_ROOT, help='music library folder (or set CHARYBDIS_LIBRARY_ROOT)')
    sub = parser.add_subparsers(dest='command', required=True)

    p = sub.add_parser('playlists', help='upload every track in the iTunes export and recreate its playlists')
    p.add_argument('--export', required=True)
    p.add_argument('--dry-run', action='store_true')
    p.set_defaults(func=cmd_playlists)

    p = sub.add_parser('recent', help='upload library files modified in the last N days')
    p.add_argument('--days', type=int, default=90)
    p.add_argument('--dry-run', action='store_true')
    p.set_defaults(func=cmd_recent)

    p = sub.add_parser('reset', help='delete everything under music/, art/ and the library table')
    p.set_defaults(func=cmd_reset)

    args = parser.parse_args()
    if not args.root:
        parser.error('library folder not set: pass --root or set CHARYBDIS_LIBRARY_ROOT')
    root = Path(os.path.realpath(args.root))
    args.func(args, Library(), root)


if __name__ == '__main__':
    main()
