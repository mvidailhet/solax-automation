import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAccessToken } from './solaxAuth.js';

test('fetchAccessToken returns the mapped access token and expiry on success', async () => {
  const fakeResponse = {
    code: 0,
    result: {
      access_token: 'abc123token',
      token_type: 'Bearer',
      expires_in: 2591999,
      scope: 'API_Telemetry_V2',
      grant_type: 'client_credentials',
      auth_station: 'all',
    },
  };
  const fetchImpl = async () => ({ json: async () => fakeResponse });

  const token = await fetchAccessToken({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    fetchImpl,
  });

  assert.equal(token.accessToken, 'abc123token');
  assert.equal(token.expiresInSeconds, 2591999);
});

test('fetchAccessToken throws using the API message when code is not 0', async () => {
  const fakeResponse = { code: 40001, message: 'Invalid client credentials' };
  const fetchImpl = async () => ({ json: async () => fakeResponse });

  await assert.rejects(
    () =>
      fetchAccessToken({
        clientId: 'bad-id',
        clientSecret: 'bad-secret',
        fetchImpl,
      }),
    /Invalid client credentials/
  );
});

test('fetchAccessToken sends a form-encoded client_credentials request', async () => {
  let capturedUrl;
  let capturedOptions;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      json: async () => ({
        code: 0,
        result: { access_token: 'tok', expires_in: 100 },
      }),
    };
  };

  await fetchAccessToken({
    clientId: 'my-client-id',
    clientSecret: 'my-client-secret',
    fetchImpl,
  });

  assert.match(capturedUrl, /\/auth\/oauth\/token$/);
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(
    capturedOptions.headers['Content-Type'],
    'application/x-www-form-urlencoded'
  );
  const body = new URLSearchParams(capturedOptions.body);
  assert.equal(body.get('client_id'), 'my-client-id');
  assert.equal(body.get('client_secret'), 'my-client-secret');
  assert.equal(body.get('grant_type'), 'client_credentials');
});

test('fetchAccessToken throws a clear error when expires_in is missing', async () => {
  const fakeResponse = {
    code: 0,
    result: { access_token: 'abc123token' },
  };
  const fetchImpl = async () => ({ json: async () => fakeResponse });

  await assert.rejects(
    () =>
      fetchAccessToken({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        fetchImpl,
      }),
    /expires_in/
  );
});

test('fetchAccessToken throws a clear error when expires_in is not numeric', async () => {
  const fakeResponse = {
    code: 0,
    result: { access_token: 'abc123token', expires_in: 'soon' },
  };
  const fetchImpl = async () => ({ json: async () => fakeResponse });

  await assert.rejects(
    () =>
      fetchAccessToken({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        fetchImpl,
      }),
    /expires_in/
  );
});

test('fetchAccessToken throws a clear error when access_token is missing', async () => {
  const fakeResponse = {
    code: 0,
    result: { expires_in: 2591999 },
  };
  const fetchImpl = async () => ({ json: async () => fakeResponse });

  await assert.rejects(
    () =>
      fetchAccessToken({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        fetchImpl,
      }),
    /access_token/
  );
});

test('fetchAccessToken throws a clear error when access_token is empty', async () => {
  const fakeResponse = {
    code: 0,
    result: { access_token: '', expires_in: 2591999 },
  };
  const fetchImpl = async () => ({ json: async () => fakeResponse });

  await assert.rejects(
    () =>
      fetchAccessToken({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        fetchImpl,
      }),
    /access_token/
  );
});

test('fetchAccessToken throws a clear error when result is missing entirely', async () => {
  const fakeResponse = { code: 0 };
  const fetchImpl = async () => ({ json: async () => fakeResponse });

  await assert.rejects(() =>
    fetchAccessToken({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      fetchImpl,
    })
  );
});
