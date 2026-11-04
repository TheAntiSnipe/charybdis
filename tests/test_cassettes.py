import json
import os
import sys

import boto3
import pytest
from moto import mock_aws

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'api'))
os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ['TABLE_NAME'] = 'test-library'

import cassettes  # noqa: E402


@pytest.fixture
def lib():
    with mock_aws():
        db = boto3.resource('dynamodb', region_name='us-east-1')
        tbl = db.create_table(
            TableName='test-library',
            AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'}, {'AttributeName': 'sk', 'AttributeType': 'S'}],
            KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}, {'AttributeName': 'sk', 'KeyType': 'RANGE'}],
            BillingMode='PAY_PER_REQUEST',
        )
        cassettes._table = tbl
        albums = [
            ('aaaaaaaaaaaa', 'Late Album', 'The Band', '2005', ['t3', 't4']),
            ('bbbbbbbbbbbb', 'Early Album', 'The Band', '1999', ['t1', 't2']),
            ('cccccccccccc', 'Solo', 'Someone Else', '2010', ['t5']),
            ('dddddddddddd', 'Undated', 'The Band', '', ['t6']),
        ]
        for album_id, title, artist, year, track_ids in albums:
            tbl.put_item(Item={'pk': 'ALBUM', 'sk': album_id, 'id': album_id, 'title': title, 'artist': artist,
                               'year': year, 'trackIds': track_ids})
        yield tbl
        cassettes._table = None


def call(route, body=None, **params):
    event = {'routeKey': route, 'pathParameters': params or None}
    if body is not None:
        event['body'] = json.dumps(body)
    res = cassettes.handler(event, None)
    return res['statusCode'], json.loads(res['body']) if 'body' in res else None


def make(kind='album', source='bbbbbbbbbbbb'):
    return call('POST /api/cassettes', {'kind': kind, 'sourceId': source})


def test_album_cassette_keeps_album_order(lib):
    status, tape = make()
    assert status == 201
    assert tape['id'] == 'album-bbbbbbbbbbbb'
    assert tape['trackIds'] == ['t1', 't2']
    assert tape['label'] == 'Early Album'
    assert tape['status'] == 'shelf'
    assert tape['progress'] == {'index': 0, 'positionSec': 0}
    assert 'pk' not in tape and 'sk' not in tape


def test_artist_cassette_is_chronological_with_undated_last(lib):
    status, tape = make('artist', 'The Band')
    assert status == 201
    assert tape['trackIds'] == ['t1', 't2', 't3', 't4', 't6']
    assert tape['pages'] == [
        {'albumId': 'bbbbbbbbbbbb', 'count': 2}, {'albumId': 'aaaaaaaaaaaa', 'count': 2}, {'albumId': 'dddddddddddd', 'count': 1},
    ]
    assert tape['label'] == 'The Band'


def test_one_cassette_per_source(lib):
    assert make()[0] == 201
    assert make()[0] == 409


def test_create_validation(lib):
    assert make('album', 'ffffffffffff')[0] == 404
    assert make('album', '../etc')[0] == 400
    assert make('artist', 'Nobody')[0] == 404
    assert make('playlist', 'x')[0] == 400
    assert call('POST /api/cassettes', {'kind': 'album'})[0] == 400


def test_track_cap(lib, monkeypatch):
    monkeypatch.setattr(cassettes, 'MAX_TRACKS', 1)
    assert make()[0] == 400


def test_list_returns_cassettes_and_entries(lib):
    make()
    call('PUT /api/cassettes/{id}/entries/{slot}', {'text': 'hello'}, id='album-bbbbbbbbbbbb', slot='0')
    status, body = call('GET /api/cassettes')
    assert status == 200
    assert [c['id'] for c in body['cassettes']] == ['album-bbbbbbbbbbbb']
    assert [(e['cassetteId'], e['slot'], e['text']) for e in body['entries']] == [('album-bbbbbbbbbbbb', 0, 'hello')]


def test_progress_saved_and_validated(lib):
    make()
    route = 'PUT /api/cassettes/{id}/progress'
    assert call(route, {'index': 1, 'positionSec': 42.9}, id='album-bbbbbbbbbbbb')[0] == 204
    progress = call('GET /api/cassettes')[1]['cassettes'][0]['progress']
    assert (progress['index'], progress['positionSec']) == (1, 42)
    assert call(route, {'index': 2, 'positionSec': 0}, id='album-bbbbbbbbbbbb')[0] == 404  # past the end
    assert call(route, {'index': 0, 'positionSec': 0}, id='album-aaaaaaaaaaaa')[0] == 404  # no such tape
    assert call(route, {'index': -1, 'positionSec': 0}, id='album-bbbbbbbbbbbb')[0] == 400
    assert call(route, {'index': 0, 'positionSec': 'x'}, id='album-bbbbbbbbbbbb')[0] == 400
    assert call(route, {'index': True, 'positionSec': 0}, id='album-bbbbbbbbbbbb')[0] == 400
    assert call(route, {'index': 0, 'positionSec': 1}, id='bad id')[0] == 400


def entry(slot, text, cassette='album-bbbbbbbbbbbb'):
    return call('PUT /api/cassettes/{id}/entries/{slot}', {'text': text}, id=cassette, slot=str(slot))


def remove(cassette='album-bbbbbbbbbbbb'):
    return call('DELETE /api/cassettes/{id}', id=cassette)


def test_delete_removes_the_tape_and_its_notes_only(lib):
    make()
    make('album', 'aaaaaaaaaaaa')
    entry(0, 'mine')
    entry(0, 'keep me', cassette='album-aaaaaaaaaaaa')
    assert remove() == (204, None)
    body = call('GET /api/cassettes')[1]
    assert [c['id'] for c in body['cassettes']] == ['album-aaaaaaaaaaaa']
    assert [(e['cassetteId'], e['text']) for e in body['entries']] == [('album-aaaaaaaaaaaa', 'keep me')]
    assert entry(0, 'late')[0] == 404


def test_delete_is_repeatable_and_the_tape_can_be_made_again(lib):
    make()
    entry(0, 'old note')
    assert remove()[0] == 204
    assert remove()[0] == 204
    assert make()[0] == 201
    assert call('GET /api/cassettes')[1]['entries'] == []


def test_delete_validates_the_id(lib):
    assert remove('../../etc')[0] == 400
    assert remove('album-zzzz')[0] == 400


def test_tape_finishes_when_every_slot_is_filled(lib):
    make()
    status, first = entry(0, '  loved the bassline  ')
    assert status == 200 and first['text'] == 'loved the bassline' and first['status'] == 'shelf'
    status, last = entry(1, 'weird but good')
    assert last['status'] == 'finished' and last['finishedAt']
    assert call('GET /api/cassettes')[1]['cassettes'][0]['status'] == 'finished'


def test_finish_check_reads_its_own_write(lib, monkeypatch):
    # DynamoDB queries are eventually consistent unless asked otherwise; a stale count would leave the last slot unfinished.
    make()
    seen = []
    real = lib.query
    monkeypatch.setattr(lib, 'query', lambda **kw: (seen.append(kw.get('ConsistentRead')), real(**kw))[1])
    entry(0, 'a')
    assert seen == [True]


def test_clearing_an_entry_reopens_a_finished_tape(lib):
    make()
    entry(0, 'a')
    assert entry(1, 'b')[1]['status'] == 'finished'
    status, reopened = entry(1, '   ')
    assert status == 200 and reopened['status'] == 'shelf' and 'finishedAt' not in reopened
    body = call('GET /api/cassettes')[1]
    assert body['cassettes'][0]['status'] == 'shelf' and 'finishedAt' not in body['cassettes'][0]
    assert [e['slot'] for e in body['entries']] == [0]


def test_entry_validation(lib):
    make()
    assert entry(2, 'past the end')[0] == 400
    assert entry('abc', 'x')[0] == 400
    assert entry(0, 'x' * 281)[0] == 400
    assert entry(0, 'x' * 280)[0] == 200
    assert entry(0, 'x', cassette='album-aaaaaaaaaaaa')[0] == 404
    assert call('PUT /api/cassettes/{id}/entries/{slot}', {'text': 5}, id='album-bbbbbbbbbbbb', slot='0')[0] == 400


def test_entries_do_not_leak_between_tapes(lib):
    make()
    make('album', 'aaaaaaaaaaaa')
    entry(0, 'a')
    entry(0, 'b', cassette='album-aaaaaaaaaaaa')
    entry(1, 'c', cassette='album-aaaaaaaaaaaa')
    tapes = {c['id']: c['status'] for c in call('GET /api/cassettes')[1]['cassettes']}
    assert tapes == {'album-bbbbbbbbbbbb': 'shelf', 'album-aaaaaaaaaaaa': 'finished'}


def test_unknown_route_and_bad_body(lib):
    assert call('GET /api/nope')[0] == 404
    res = cassettes.handler({'routeKey': 'POST /api/cassettes', 'body': 'not json'}, None)
    assert res['statusCode'] == 400


def settings(body, cassette='album-bbbbbbbbbbbb'):
    return call('PUT /api/cassettes/{id}/settings', body, id=cassette)


def test_settings_set_title_and_style(lib):
    make()
    status, tape = settings({'title': '  Road trip  ', 'style': 'clear'})
    assert status == 200
    assert tape['title'] == 'Road trip' and tape['style'] == 'clear'
    assert tape['label'] == 'Early Album' and tape['trackIds'] == ['t1', 't2']
    assert 'pk' not in tape
    saved = call('GET /api/cassettes')[1]['cassettes'][0]
    assert saved['title'] == 'Road trip' and saved['style'] == 'clear'


def test_settings_each_field_on_its_own(lib):
    make()
    assert settings({'style': 'executive'})[1]['style'] == 'executive'
    status, tape = settings({'title': 'Mine'})
    assert status == 200 and tape['style'] == 'executive' and tape['title'] == 'Mine'


def test_settings_clear_title(lib):
    make()
    settings({'title': 'Mine', 'style': 'cover'})
    for cleared in ('', '   ', None):
        settings({'title': 'Mine'})
        status, tape = settings({'title': cleared})
        assert status == 200 and 'title' not in tape and tape['style'] == 'cover'


def test_settings_validation(lib):
    make()
    assert settings({'title': 'x' * 41})[0] == 400
    assert settings({'title': 'x' * 40})[0] == 200
    assert settings({'title': 5})[0] == 400
    assert settings({'style': 'neon'})[0] == 400
    assert settings({'style': None})[0] == 400
    assert settings({})[0] == 400
    assert settings({'title': 'x'}, cassette='album-aaaaaaaaaaaa')[0] == 404
    assert settings({'title': 'x'}, cassette='bad id')[0] == 400


def test_settings_do_not_disturb_progress_or_entries(lib):
    make()
    call('PUT /api/cassettes/{id}/progress', {'index': 1, 'positionSec': 12}, id='album-bbbbbbbbbbbb')
    entry(0, 'note')
    settings({'title': 'Renamed', 'style': 'clear'})
    body = call('GET /api/cassettes')[1]
    assert body['cassettes'][0]['progress']['index'] == 1
    assert [e['text'] for e in body['entries']] == ['note']


def hero(track, album='bbbbbbbbbbbb'):
    return call('PUT /api/heroes/{albumId}', {'trackId': track}, albumId=album)


def test_hero_is_one_song_per_album_and_replaceable(lib):
    assert call('GET /api/heroes')[1] == {'heroes': []}
    assert hero('t1')[0] == 200
    assert hero('t2')[1] == {'albumId': 'bbbbbbbbbbbb', 'trackId': 't2'}
    assert hero('t5', 'cccccccccccc')[0] == 200
    heroes = call('GET /api/heroes')[1]['heroes']
    assert sorted((h['albumId'], h['trackId']) for h in heroes) == [('bbbbbbbbbbbb', 't2'), ('cccccccccccc', 't5')]


def test_hero_can_be_cleared_and_clearing_twice_is_fine(lib):
    hero('t1')
    assert hero(None)[0] == 204
    assert hero(None)[0] == 204
    assert call('GET /api/heroes')[1] == {'heroes': []}


def test_hero_validation(lib):
    assert hero('t3')[0] == 400  # on another album
    assert hero('t1', 'ffffffffffff')[0] == 404
    assert hero('t1', 'not an id')[0] == 400
    assert hero(5)[0] == 400
    assert hero('')[0] == 400
    assert call('PUT /api/heroes/{albumId}', {}, albumId='bbbbbbbbbbbb')[0] == 400
    assert call('GET /api/heroes')[1] == {'heroes': []}


def test_hero_survives_deleting_a_cassette(lib):
    make()
    hero('t1')
    call('DELETE /api/cassettes/{id}', id='album-bbbbbbbbbbbb')
    assert [h['trackId'] for h in call('GET /api/heroes')[1]['heroes']] == ['t1']


def test_hero_keeps_the_review_wording_it_was_saved_with(lib):
    body = {'trackId': 't1', 'phrase': 'is a masterpiece', 'source': 'NME'}
    status, saved = call('PUT /api/heroes/{albumId}', body, albumId='bbbbbbbbbbbb')
    assert status == 200 and saved == {'albumId': 'bbbbbbbbbbbb', **body}
    assert call('GET /api/heroes')[1]['heroes'] == [{'albumId': 'bbbbbbbbbbbb', **body}]


def test_hero_review_wording_is_validated(lib):
    for bad in ({'phrase': 5}, {'source': ''}, {'phrase': 'x' * 201}):
        assert call('PUT /api/heroes/{albumId}', {'trackId': 't1', **bad}, albumId='bbbbbbbbbbbb')[0] == 400
    assert call('GET /api/heroes')[1] == {'heroes': []}
