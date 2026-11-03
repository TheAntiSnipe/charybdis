"""Tape deck API: cassettes (frozen track lists), their resume point, and journal entries.

Single-table layout (see docs/tape-deck-design.md):
  CASSETTE  sk = album-<albumId> | artist-<sha1(name)[:16]>
  ENTRY     sk = <cassetteId>#<slot, 4 digits>
"""
import base64
import hashlib
import json
import math
import os
import re
import time
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

MAX_TRACKS = 2000
MAX_TEXT = 280
MAX_NAME = 200
CASSETTE_ID = re.compile(r'^(album|artist)-[0-9a-f]{12,16}$')
ALBUM_ID = re.compile(r'^[0-9a-f]{12}$')
SLOT = re.compile(r'^[0-9]{1,4}$')

_table = None


def table():
    global _table
    if _table is None:
        _table = boto3.resource('dynamodb').Table(os.environ['TABLE_NAME'])
    return _table


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def _json_default(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(f'Cannot serialize {type(value)}')


def _response(status, body=None):
    out = {'statusCode': status, 'headers': {'Cache-Control': 'no-store'}}
    if body is not None:
        out['headers']['Content-Type'] = 'application/json'
        out['body'] = json.dumps(body, default=_json_default)
    return out


def _body(event):
    raw = event.get('body') or ''
    if event.get('isBase64Encoded'):
        raw = base64.b64decode(raw).decode('utf-8', errors='replace')
    try:
        data = json.loads(raw)
    except ValueError:
        raise ApiError(400, 'Body must be JSON')
    if not isinstance(data, dict):
        raise ApiError(400, 'Body must be a JSON object')
    return data


def _query(pk, prefix=None, consistent=False):
    condition = Key('pk').eq(pk)
    if prefix:
        condition = condition & Key('sk').begins_with(prefix)
    items, kwargs = [], {'KeyConditionExpression': condition, 'ConsistentRead': consistent}
    while True:
        page = table().query(**kwargs)
        items.extend(page['Items'])
        if 'LastEvaluatedKey' not in page:
            return items
        kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']


def _public_cassette(item):
    return {k: v for k, v in item.items() if k not in ('pk', 'sk')}


def _public_entry(item):
    cassette_id, slot = item['sk'].split('#')
    return {'cassetteId': cassette_id, 'slot': int(slot), 'text': item['text'], 'updatedAt': item['updatedAt']}


def _cassette_id(event):
    cassette_id = (event.get('pathParameters') or {}).get('id', '')
    if not CASSETTE_ID.match(cassette_id):
        raise ApiError(400, 'Invalid cassette id')
    return cassette_id


def _get_cassette(cassette_id):
    item = table().get_item(Key={'pk': 'CASSETTE', 'sk': cassette_id}).get('Item')
    if item is None:
        raise ApiError(404, 'No such cassette')
    return item


def list_cassettes(_event):
    return _response(200, {
        'cassettes': [_public_cassette(i) for i in _query('CASSETTE')],
        'entries': [_public_entry(i) for i in _query('ENTRY')],
    })


def _sources(kind, source):
    """Returns (cassette id, label, albums in listening order) for an album or an artist."""
    if kind == 'album':
        if not ALBUM_ID.match(source):
            raise ApiError(400, 'Invalid album id')
        album = table().get_item(Key={'pk': 'ALBUM', 'sk': source}).get('Item')
        if album is None:
            raise ApiError(404, 'No such album')
        return f'album-{source}', album.get('title') or 'Untitled', [album]

    albums = [a for a in _query('ALBUM') if a.get('artist') == source]
    if not albums:
        raise ApiError(404, 'No such artist')
    albums.sort(key=lambda a: (a.get('year') or '9999', a.get('title') or ''))
    digest = hashlib.sha1(source.encode('utf-8')).hexdigest()[:16]
    return f'artist-{digest}', source, albums


def create_cassette(event):
    data = _body(event)
    kind, source = data.get('kind'), data.get('sourceId')
    if kind not in ('album', 'artist') or not isinstance(source, str) or not 0 < len(source) <= MAX_NAME:
        raise ApiError(400, 'Expected kind (album|artist) and sourceId')

    cassette_id, label, albums = _sources(kind, source)
    pages = [{'albumId': a['sk'], 'count': len(a['trackIds'])} for a in albums if a.get('trackIds')]
    track_ids = [t for a in albums for t in a.get('trackIds', [])]
    if not track_ids:
        raise ApiError(400, 'Nothing to put on this cassette')
    if len(track_ids) > MAX_TRACKS:
        raise ApiError(400, f'Too many tracks for one cassette (max {MAX_TRACKS})')

    item = {
        'pk': 'CASSETTE', 'sk': cassette_id, 'id': cassette_id, 'kind': kind, 'sourceId': source,
        'label': label, 'trackIds': track_ids, 'pages': pages,
        'progress': {'index': 0, 'positionSec': 0}, 'status': 'shelf', 'createdAt': int(time.time()),
    }
    try:
        table().put_item(Item=item, ConditionExpression='attribute_not_exists(pk)')
    except ClientError as err:
        if err.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise ApiError(409, 'That cassette already exists')
        raise
    return _response(201, _public_cassette(item))


def _number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ApiError(400, f'{name} must be a non-negative number')
    return value


def save_progress(event):
    cassette_id = _cassette_id(event)
    data = _body(event)
    index, position = data.get('index'), _number(data.get('positionSec'), 'positionSec')
    if isinstance(index, bool) or not isinstance(index, int) or index < 0:
        raise ApiError(400, 'index must be a non-negative integer')
    try:
        table().update_item(
            Key={'pk': 'CASSETTE', 'sk': cassette_id},
            UpdateExpression='SET progress = :p',
            ConditionExpression='attribute_exists(pk) AND size(trackIds) > :i',
            ExpressionAttributeValues={
                ':p': {'index': index, 'positionSec': min(int(position), 100000), 'updatedAt': int(time.time())},
                ':i': index,
            },
        )
    except ClientError as err:
        if err.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise ApiError(404, 'No such cassette or track position')
        raise
    return _response(204)


def save_entry(event):
    cassette_id = _cassette_id(event)
    slot_param = (event.get('pathParameters') or {}).get('slot', '')
    if not SLOT.match(slot_param):
        raise ApiError(400, 'Invalid slot')
    slot = int(slot_param)

    text = _body(event).get('text')
    if not isinstance(text, str):
        raise ApiError(400, 'text must be a string')
    text = text.strip()
    if len(text) > MAX_TEXT:
        raise ApiError(400, f'Entries are limited to {MAX_TEXT} characters')

    cassette = _get_cassette(cassette_id)
    if slot >= len(cassette['trackIds']):
        raise ApiError(400, 'Slot is past the end of the tape')

    sk = f'{cassette_id}#{slot:04d}'
    now = int(time.time())
    if text:
        table().put_item(Item={'pk': 'ENTRY', 'sk': sk, 'text': text, 'updatedAt': now})
    else:
        table().delete_item(Key={'pk': 'ENTRY', 'sk': sk})

    # A tape is finished exactly when every slot has text; the server is the only writer of that state.
    # Consistent read: the note just written must count, or the last slot would never finish the tape.
    filled = len(_query('ENTRY', f'{cassette_id}#', consistent=True))
    status = 'finished' if filled >= len(cassette['trackIds']) else 'shelf'
    finished_at = cassette.get('finishedAt')
    if status != cassette.get('status'):
        key = {'pk': 'CASSETTE', 'sk': cassette_id}
        if status == 'finished':
            finished_at = now
            table().update_item(
                Key=key, UpdateExpression='SET #s = :s, finishedAt = :t',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={':s': status, ':t': now},
            )
        else:
            finished_at = None
            table().update_item(
                Key=key, UpdateExpression='SET #s = :s REMOVE finishedAt',
                ExpressionAttributeNames={'#s': 'status'}, ExpressionAttributeValues={':s': status},
            )

    body = {'cassetteId': cassette_id, 'slot': slot, 'text': text, 'updatedAt': now, 'status': status}
    if finished_at:
        body['finishedAt'] = finished_at
    return _response(200, body)


STYLES = ('generated', 'cover', 'executive', 'clear')
MAX_TITLE = 40


def save_settings(event):
    cassette_id = _cassette_id(event)
    data = _body(event)
    sets, removes, names, values = [], [], {}, {}

    if 'title' in data:
        title = data['title']
        if title is not None and not isinstance(title, str):
            raise ApiError(400, 'title must be text or null')
        title = (title or '').strip()
        if len(title) > MAX_TITLE:
            raise ApiError(400, f'Titles are limited to {MAX_TITLE} characters')
        if title:
            sets.append('title = :title')
            values[':title'] = title
        else:
            removes.append('title')

    if 'style' in data:
        if data['style'] not in STYLES:
            raise ApiError(400, f"style must be one of {', '.join(STYLES)}")
        sets.append('#style = :style')
        names['#style'] = 'style'
        values[':style'] = data['style']

    if not sets and not removes:
        raise ApiError(400, 'Nothing to change')

    expression = ('SET ' + ', '.join(sets) if sets else '') + (' REMOVE ' + ', '.join(removes) if removes else '')
    kwargs = {
        'Key': {'pk': 'CASSETTE', 'sk': cassette_id},
        'UpdateExpression': expression.strip(),
        'ConditionExpression': 'attribute_exists(pk)',
        'ReturnValues': 'ALL_NEW',
    }
    if names:
        kwargs['ExpressionAttributeNames'] = names
    if values:
        kwargs['ExpressionAttributeValues'] = values
    try:
        updated = table().update_item(**kwargs)['Attributes']
    except ClientError as err:
        if err.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise ApiError(404, 'No such cassette')
        raise
    return _response(200, _public_cassette(updated))


ROUTES = {
    'GET /api/cassettes': list_cassettes,
    'POST /api/cassettes': create_cassette,
    'PUT /api/cassettes/{id}/progress': save_progress,
    'PUT /api/cassettes/{id}/settings': save_settings,
    'PUT /api/cassettes/{id}/entries/{slot}': save_entry,
}


def handler(event, _context):
    route = ROUTES.get(event.get('routeKey'))
    if route is None:
        return _response(404, {'error': 'Not found'})
    try:
        return route(event)
    except ApiError as err:
        return _response(err.status, {'error': err.message})
