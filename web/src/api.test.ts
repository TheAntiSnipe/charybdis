import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, deleteCassette, isRetryable, OFFLINE_MESSAGE, saveJournalEntry } from './api';
import { createProgressSaver, PROGRESS_RETRY_MS } from './progressSave';

vi.mock('./auth', () => ({
  getSession: async () => ({ getAccessToken: () => ({ getJwtToken: () => 'token' }), getIdToken: () => ({ getJwtToken: () => 'token' }) }),
}));

describe('isRetryable', () => {
  it('retries what a later attempt could fix and gives up on refusals', () => {
    for (const status of [0, 401, 403, 408, 429, 500, 502, 503]) expect(isRetryable(new ApiError('x', status))).toBe(true);
    for (const status of [400, 404, 409, 413]) expect(isRetryable(new ApiError('x', status))).toBe(false);
    expect(isRetryable(new Error('Not signed in'))).toBe(true);
  });
});

describe('network failures', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('become a plain "can’t reach" error rather than "Failed to fetch"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(saveJournalEntry('album-aaaaaaaaaaaa', 0, 'x')).rejects.toMatchObject({ status: 0, message: OFFLINE_MESSAGE });
    await expect(deleteCassette('album-aaaaaaaaaaaa')).rejects.toMatchObject({ status: 0, message: OFFLINE_MESSAGE });
  });

  it('delete sends DELETE to the tape and accepts 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteCassette('album-aaaaaaaaaaaa');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/cassettes/album-aaaaaaaaaaaa');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
  });

  it('delete reports the server’s reason when it refuses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid cassette id' }), { status: 400 })));
    await expect(deleteCassette('x')).rejects.toMatchObject({ status: 400, message: 'Invalid cassette id' });
  });
});

describe('progress saver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it('sends the place, and only the newest one if more arrive during a save', async () => {
    const releases: (() => void)[] = [];
    const send = vi.fn(() => new Promise<void>((resolve) => { releases.push(resolve); }));
    const saver = createProgressSaver(send);
    saver.save('a', 0, 10);
    saver.save('a', 0, 25);
    saver.save('a', 1, 5);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith('a', 0, 10);
    releases[0]();
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('a', 1, 5);
    releases[1]();
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('waits and tries again after a failure, with a growing wait', async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiError('x', 0)).mockRejectedValueOnce(new ApiError('x', 503)).mockResolvedValue(undefined);
    const saver = createProgressSaver(send);
    saver.save('a', 2, 40);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PROGRESS_RETRY_MS[0] - 1);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(PROGRESS_RETRY_MS[1]);
    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('sends the newest place when the retry comes, not the one that failed', async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiError('x', 0)).mockResolvedValue(undefined);
    const saver = createProgressSaver(send);
    saver.save('a', 0, 10);
    await flush();
    saver.save('a', 0, 55);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PROGRESS_RETRY_MS[0]);
    expect(send).toHaveBeenLastCalledWith('a', 0, 55);
  });

  it('gives up on a refusal and does not retry', async () => {
    const send = vi.fn().mockRejectedValue(new ApiError('No such cassette', 404));
    const saver = createProgressSaver(send);
    saver.save('a', 0, 10);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries at once on request, and stops for a forgotten tape', async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiError('x', 0)).mockResolvedValue(undefined);
    const saver = createProgressSaver(send);
    saver.save('a', 0, 10);
    saver.save('b', 0, 10);
    await flush();
    saver.forget('b');
    saver.retryNow();
    await flush();
    expect(send.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'a']);
    saver.save('b', 3, 3);
    await flush();
    expect(send).toHaveBeenCalledTimes(3);
    saver.revive('b');
    saver.save('b', 3, 3);
    await flush();
    expect(send).toHaveBeenCalledTimes(4);
  });
});
