import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccessTokenCache } from './accessTokenCache.js';

test('fetches a token on first call and reuses it while still valid', async () => {
  let fetchCallCount = 0;
  const fetchAccessTokenImpl = async () => {
    fetchCallCount += 1;
    return { accessToken: `token-${fetchCallCount}`, expiresInSeconds: 3600 };
  };
  let currentTime = 1000000;
  const now = () => currentTime;

  const cache = createAccessTokenCache({
    clientId: 'id',
    clientSecret: 'secret',
    fetchAccessTokenImpl,
    now,
  });

  const first = await cache.getAccessToken();
  currentTime += 1000; // small amount of time passes, well within validity
  const second = await cache.getAccessToken();

  assert.equal(first, 'token-1');
  assert.equal(second, 'token-1');
  assert.equal(fetchCallCount, 1);
});

test('refetches a new token once the refresh buffer window is reached', async () => {
  let fetchCallCount = 0;
  const fetchAccessTokenImpl = async () => {
    fetchCallCount += 1;
    return { accessToken: `token-${fetchCallCount}`, expiresInSeconds: 3600 };
  };
  let currentTime = 1000000;
  const now = () => currentTime;

  const cache = createAccessTokenCache({
    clientId: 'id',
    clientSecret: 'secret',
    fetchAccessTokenImpl,
    now,
  });

  const first = await cache.getAccessToken();
  // advance past (expiresInSeconds * 1000 - REFRESH_BUFFER_MS)
  currentTime += 3600 * 1000 - 300000 + 1;
  const second = await cache.getAccessToken();

  assert.equal(first, 'token-1');
  assert.equal(second, 'token-2');
  assert.equal(fetchCallCount, 2);
});

test('passes clientId and clientSecret through to fetchAccessTokenImpl', async () => {
  let capturedArgs;
  const fetchAccessTokenImpl = async (args) => {
    capturedArgs = args;
    return { accessToken: 'tok', expiresInSeconds: 3600 };
  };

  const cache = createAccessTokenCache({
    clientId: 'my-id',
    clientSecret: 'my-secret',
    fetchAccessTokenImpl,
    now: () => 0,
  });
  await cache.getAccessToken();

  assert.equal(capturedArgs.clientId, 'my-id');
  assert.equal(capturedArgs.clientSecret, 'my-secret');
});
