import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRealtimeData } from './solaxClient.js';

test('fetchRealtimeData returns the first device record on success', async () => {
  const fakeResponse = {
    code: 10000,
    result: [{ deviceSn: 'ABC123', acPower1: 1.2 }],
  };
  const fetchImpl = async () => ({ json: async () => fakeResponse });

  const record = await fetchRealtimeData('ABC123', { token: 'test-token', fetchImpl });

  assert.equal(record.deviceSn, 'ABC123');
  assert.equal(record.acPower1, 1.2);
});

test('fetchRealtimeData throws using the API message when code is not 10000', async () => {
  const fakeResponse = { code: 40000, message: 'Invalid token' };
  const fetchImpl = async () => ({ json: async () => fakeResponse });

  await assert.rejects(
    () => fetchRealtimeData('ABC123', { token: 'bad-token', fetchImpl }),
    /Invalid token/
  );
});

test('fetchRealtimeData throws a device-specific error when the API returns no result rows', async () => {
  const fakeResponse = { code: 10000, result: [] };
  const fetchImpl = async () => ({ json: async () => fakeResponse });

  await assert.rejects(
    () => fetchRealtimeData('WRONG-SN', { token: 'test-token', fetchImpl }),
    /WRONG-SN/
  );
});

test('fetchRealtimeData sends the bearer token and device serial in the request', async () => {
  let capturedUrl;
  let capturedOptions;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return { json: async () => ({ code: 10000, result: [{}] }) };
  };

  await fetchRealtimeData('XYZ789', { token: 'secret-token', fetchImpl });

  assert.match(capturedUrl, /snList=XYZ789/);
  assert.equal(capturedOptions.headers.Authorization, 'bearer secret-token');
});
