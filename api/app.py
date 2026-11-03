import base64
import json
import os
import re
import time
from decimal import Decimal
from urllib.parse import urlparse

import boto3
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

COOKIE_TTL_SECONDS = 12 * 3600
HOST_PATTERN = re.compile(r'^[a-z0-9.-]+$')

_table = boto3.resource('dynamodb').Table(os.environ['TABLE_NAME'])
_ssm = boto3.client('ssm')
_private_key = None


def _signing_key():
    global _private_key
    if _private_key is None:
        pem = _ssm.get_parameter(Name=os.environ['PRIVATE_KEY_PARAM'], WithDecryption=True)['Parameter']['Value']
        _private_key = serialization.load_pem_private_key(pem.encode(), password=None)
    return _private_key


def _cf_b64(raw: bytes) -> str:
    # CloudFront's URL-safe base64 variant
    return base64.b64encode(raw).decode().replace('+', '-').replace('=', '_').replace('/', '~')


def _response(status, body=None, cookies=None):
    out = {'statusCode': status, 'headers': {'Cache-Control': 'no-store'}}
    if body is not None:
        out['headers']['Content-Type'] = 'application/json'
        out['body'] = json.dumps(body, default=_json_default)
    if cookies:
        out['cookies'] = cookies
    return out


def _json_default(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(f'Cannot serialize {type(value)}')


def create_session(event):
    # The cookie is host-only, so the policy host is whichever host the browser called.
    host = urlparse(event['headers'].get('origin', '')).hostname or ''
    if not HOST_PATTERN.match(host):
        return _response(400, {'error': 'Origin header required'})

    expires = int(time.time()) + COOKIE_TTL_SECONDS
    policy = json.dumps(
        {'Statement': [{'Resource': f'https://{host}/*', 'Condition': {'DateLessThan': {'AWS:EpochTime': expires}}}]},
        separators=(',', ':'),
    ).encode()
    signature = _signing_key().sign(policy, padding.PKCS1v15(), hashes.SHA1())  # CloudFront requires RSA-SHA1

    attrs = f'Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age={COOKIE_TTL_SECONDS}'
    cookies = [
        f'CloudFront-Policy={_cf_b64(policy)}; {attrs}',
        f'CloudFront-Signature={_cf_b64(signature)}; {attrs}',
        f"CloudFront-Key-Pair-Id={os.environ['KEY_PAIR_ID']}; {attrs}",
    ]
    return _response(200, {'expiresAt': expires}, cookies)


def _items(entity):
    items, kwargs = [], {'KeyConditionExpression': 'pk = :pk', 'ExpressionAttributeValues': {':pk': entity}}
    while True:
        page = _table.query(**kwargs)
        items.extend(page['Items'])
        if 'LastEvaluatedKey' not in page:
            return items
        kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']


def get_library(_event):
    strip = lambda item: {k: v for k, v in item.items() if k not in ('pk', 'sk')}
    return _response(200, {
        'tracks': [strip(i) for i in _items('TRACK')],
        'albums': [strip(i) for i in _items('ALBUM')],
        'playlists': [strip(i) for i in _items('PLAYLIST')],
    })


ROUTES = {
    'POST /api/session': create_session,
    'GET /api/library': get_library,
}


def handler(event, _context):
    route = ROUTES.get(event.get('routeKey'))
    if route is None:
        return _response(404, {'error': 'Not found'})
    return route(event)
