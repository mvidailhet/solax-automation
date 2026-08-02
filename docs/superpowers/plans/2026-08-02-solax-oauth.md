# SolaX OAuth Access Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The polling script obtains and refreshes its own SolaX Cloud access token via the OAuth `client_credentials` grant, replacing the manually-copied `SOLAX_API_TOKEN`.

**Architecture:** A pure HTTP module (`solaxAuth.js`, mirrors `solaxClient.js`'s shape) wraps the token endpoint; a small stateful cache (`accessTokenCache.js`) remembers the token and its expiry so `index.js` only re-authenticates when needed, not on every poll.

**Tech Stack:** Node.js 18+, ESM, built-in `fetch`, built-in `node:test` + `node:assert/strict`. No new dependencies.

## Global Constraints

- Auth endpoint: `POST https://openapi-eu.solaxcloud.com/openapi/auth/oauth/token`, `application/x-www-form-urlencoded` body: `client_id`, `client_secret`, `grant_type=client_credentials`.
- This endpoint's success code is **`0`** — a separate constant from `realtime_data`'s `10000`. Do not share or reuse that constant.
- Success response shape: `{ code: 0, result: { access_token, token_type, expires_in, scope, grant_type, auth_station } }`. `expires_in` is seconds.
- Non-`0` code is a failure; the body's `message` describes it (same convention as `solaxClient.js`).
- No `refresh_token` for this grant — re-authenticate with `client_id`/`client_secret` when the cached token is near expiry.
- `REFRESH_BUFFER_MS` is a named constant: `300000` (5 minutes) — refresh this many ms before the token's actual expiry, not exactly at expiry.
- `.env`/`.env.example`: remove `SOLAX_API_TOKEN`; add `SOLAX_CLIENT_ID` and `SOLAX_CLIENT_SECRET`. No backward-compatibility fallback for the old variable.
- `src/solaxClient.js` and `src/energyReading.js` are not modified by this plan.
- The first token fetch happens inside the first `pollOnce()` call (no separate startup-only auth step); a failure there is caught by the existing per-tick try/catch, logged, and retried next tick — same as any other poll failure.

---

## File Structure

- `src/solaxAuth.js` — `fetchAccessToken({ clientId, clientSecret, baseUrl, fetchImpl })`: posts the form-encoded `client_credentials` request, returns `{ accessToken, expiresInSeconds }`, throws on non-`0` code.
- `src/solaxAuth.test.js` — tests `fetchAccessToken` against an injected fake `fetch`.
- `src/accessTokenCache.js` — `createAccessTokenCache({ clientId, clientSecret, fetchAccessTokenImpl, now })`: returns `{ getAccessToken(): Promise<string> }`, caching the token until `REFRESH_BUFFER_MS` before its expiry.
- `src/accessTokenCache.test.js` — tests the cache's fetch-once/reuse/refetch-after-expiry behavior using injected fakes for both the HTTP call and the clock.
- Modify `src/index.js` — read `SOLAX_CLIENT_ID`/`SOLAX_CLIENT_SECRET` instead of `SOLAX_API_TOKEN`; create one `accessTokenCache` at startup; `pollOnce` asks it for a token before calling `fetchRealtimeData`.
- Modify `.env.example` — replace `SOLAX_API_TOKEN` with `SOLAX_CLIENT_ID`/`SOLAX_CLIENT_SECRET`.
- Modify `README.md` — update setup instructions for the new variables.

---

### Task 1: SolaX OAuth token client

**Files:**
- Create: `src/solaxAuth.js`
- Test: `src/solaxAuth.test.js`

**Interfaces:**
- Consumes: nothing from earlier work.
- Produces: `fetchAccessToken({ clientId, clientSecret, baseUrl, fetchImpl })` — an async function returning `{ accessToken: string, expiresInSeconds: number }`. `baseUrl` defaults to `https://openapi-eu.solaxcloud.com/openapi`, `fetchImpl` defaults to the global `fetch`. Throws `Error` with the API's `message` when `code !== 0`. Task 2 (`accessTokenCache.js`) calls this with `{ clientId, clientSecret }` (its own defaults apply); Task 3 (`index.js`) does not call this directly.

- [ ] **Step 1: Write the failing tests**

Create `src/solaxAuth.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/solaxAuth.js` does not exist / export not found.

- [ ] **Step 3: Write the implementation**

Create `src/solaxAuth.js`:

```js
const DEFAULT_BASE_URL = 'https://openapi-eu.solaxcloud.com/openapi';
const TOKEN_PATH = '/auth/oauth/token';
const AUTH_SUCCESS_CODE = 0;
const CLIENT_CREDENTIALS_GRANT_TYPE = 'client_credentials';

export async function fetchAccessToken({
  clientId,
  clientSecret,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
}) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: CLIENT_CREDENTIALS_GRANT_TYPE,
  });

  const response = await fetchImpl(`${baseUrl}${TOKEN_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const responseBody = await response.json();

  if (responseBody.code !== AUTH_SUCCESS_CODE) {
    throw new Error(
      responseBody.message ?? `SolaX auth error (code ${responseBody.code})`
    );
  }

  return {
    accessToken: responseBody.result.access_token,
    expiresInSeconds: responseBody.result.expires_in,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 3 tests in `src/solaxAuth.test.js` green, plus the existing 11 tests still green (14 total).

- [ ] **Step 5: Commit**

```bash
git add src/solaxAuth.js src/solaxAuth.test.js
git commit -m "feat: add SolaX OAuth client_credentials token client"
```

---

### Task 2: Access token cache

**Files:**
- Create: `src/accessTokenCache.js`
- Test: `src/accessTokenCache.test.js`

**Interfaces:**
- Consumes: `fetchAccessToken({ clientId, clientSecret, baseUrl, fetchImpl })` from Task 1 (`src/solaxAuth.js`), as its default `fetchAccessTokenImpl`.
- Produces: `createAccessTokenCache({ clientId, clientSecret, fetchAccessTokenImpl, now })` — a factory function returning `{ getAccessToken: () => Promise<string> }`. `fetchAccessTokenImpl` defaults to `fetchAccessToken` from `src/solaxAuth.js`; `now` defaults to `Date.now`. Task 3 (`index.js`) calls `createAccessTokenCache({ clientId, clientSecret })` once at startup and calls `.getAccessToken()` on every poll tick.

- [ ] **Step 1: Write the failing tests**

Create `src/accessTokenCache.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/accessTokenCache.js` does not exist / export not found.

- [ ] **Step 3: Write the implementation**

Create `src/accessTokenCache.js`:

```js
import { fetchAccessToken } from './solaxAuth.js';

const REFRESH_BUFFER_MS = 300000;

export function createAccessTokenCache({
  clientId,
  clientSecret,
  fetchAccessTokenImpl = fetchAccessToken,
  now = Date.now,
}) {
  let cachedToken = null;
  let cachedTokenExpiresAt = 0;

  async function getAccessToken() {
    if (cachedToken && now() < cachedTokenExpiresAt) {
      return cachedToken;
    }

    const { accessToken, expiresInSeconds } = await fetchAccessTokenImpl({
      clientId,
      clientSecret,
    });

    cachedToken = accessToken;
    cachedTokenExpiresAt = now() + expiresInSeconds * 1000 - REFRESH_BUFFER_MS;

    return cachedToken;
  }

  return { getAccessToken };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 3 tests in `src/accessTokenCache.test.js` green, plus all prior tests still green (17 total).

- [ ] **Step 5: Commit**

```bash
git add src/accessTokenCache.js src/accessTokenCache.test.js
git commit -m "feat: add access token cache with proactive refresh"
```

---

### Task 3: Wire the token cache into the polling loop

**Files:**
- Modify: `src/index.js`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `createAccessTokenCache({ clientId, clientSecret })` from Task 2 (`src/accessTokenCache.js`), returning `{ getAccessToken: () => Promise<string> }`. `fetchRealtimeData(deviceSn, { token })` from `src/solaxClient.js` (unchanged, already reviewed) — `token` now comes from `accessTokenCache.getAccessToken()` instead of `requireEnv('SOLAX_API_TOKEN')`.
- Produces: the updated runnable entry point. No further tasks depend on this one.

Current `src/index.js` (for reference — you are modifying this file):

```js
import 'dotenv/config';
import { fetchRealtimeData } from './solaxClient.js';
import { toEnergyReading } from './energyReading.js';

const DEFAULT_POLL_INTERVAL_MS = 60000;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function formatReading(reading) {
  return (
    `[${reading.timestamp}] ` +
    `production=${reading.solarProductionWatts}W consumption=${reading.houseConsumptionWatts}W | ` +
    `today production=${reading.dailyProductionKwh}kWh consumption=${reading.dailyConsumptionKwh}kWh`
  );
}

async function pollOnce(deviceSn, token) {
  try {
    const rawDeviceRecord = await fetchRealtimeData(deviceSn, { token });
    const reading = toEnergyReading(rawDeviceRecord);
    console.log(formatReading(reading));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Poll failed: ${error.message}`);
  }
}

function main() {
  const deviceSn = requireEnv('SOLAX_DEVICE_SN');
  const token = requireEnv('SOLAX_API_TOKEN');
  const configuredIntervalMs = Number(process.env.SOLAX_POLL_INTERVAL_MS);
  const pollIntervalMs =
    Number.isFinite(configuredIntervalMs) && configuredIntervalMs > 0
      ? configuredIntervalMs
      : DEFAULT_POLL_INTERVAL_MS;

  pollOnce(deviceSn, token);
  setInterval(() => pollOnce(deviceSn, token), pollIntervalMs);
}

main();
```

- [ ] **Step 1: Rewrite `src/index.js`**

Replace the full file contents with:

```js
import 'dotenv/config';
import { fetchRealtimeData } from './solaxClient.js';
import { toEnergyReading } from './energyReading.js';
import { createAccessTokenCache } from './accessTokenCache.js';

const DEFAULT_POLL_INTERVAL_MS = 60000;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function formatReading(reading) {
  return (
    `[${reading.timestamp}] ` +
    `production=${reading.solarProductionWatts}W consumption=${reading.houseConsumptionWatts}W | ` +
    `today production=${reading.dailyProductionKwh}kWh consumption=${reading.dailyConsumptionKwh}kWh`
  );
}

async function pollOnce(deviceSn, accessTokenCache) {
  try {
    const token = await accessTokenCache.getAccessToken();
    const rawDeviceRecord = await fetchRealtimeData(deviceSn, { token });
    const reading = toEnergyReading(rawDeviceRecord);
    console.log(formatReading(reading));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Poll failed: ${error.message}`);
  }
}

function main() {
  const deviceSn = requireEnv('SOLAX_DEVICE_SN');
  const clientId = requireEnv('SOLAX_CLIENT_ID');
  const clientSecret = requireEnv('SOLAX_CLIENT_SECRET');
  const configuredIntervalMs = Number(process.env.SOLAX_POLL_INTERVAL_MS);
  const pollIntervalMs =
    Number.isFinite(configuredIntervalMs) && configuredIntervalMs > 0
      ? configuredIntervalMs
      : DEFAULT_POLL_INTERVAL_MS;

  const accessTokenCache = createAccessTokenCache({ clientId, clientSecret });

  pollOnce(deviceSn, accessTokenCache);
  setInterval(() => pollOnce(deviceSn, accessTokenCache), pollIntervalMs);
}

main();
```

- [ ] **Step 2: Update `.env.example`**

Replace its contents with:

```
SOLAX_CLIENT_ID=your-solax-cloud-oauth-client-id
SOLAX_CLIENT_SECRET=your-solax-cloud-oauth-client-secret
SOLAX_DEVICE_SN=your-inverter-or-dongle-serial-number
SOLAX_POLL_INTERVAL_MS=60000
```

- [ ] **Step 3: Update `README.md`**

Update the "Setup" section's step 2 to read:

```markdown
2. Copy `.env.example` to `.env` and fill in `SOLAX_CLIENT_ID`,
   `SOLAX_CLIENT_SECRET`, and `SOLAX_DEVICE_SN` from your SolaX Cloud
   developer account. The script obtains and refreshes its own access
   token automatically — no manual token copying needed.
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — all 17 tests green (index.js itself has no unit tests, per the existing plan's convention — it's thin orchestration, verified by the modules it wires together plus manual runs).

- [ ] **Step 5: Sanity-check syntax**

Run: `node --check src/index.js`
Expected: no output, exit code 0.

- [ ] **Step 6: Manually verify against the real API**

Update your local `.env` (not committed) to use `SOLAX_CLIENT_ID`/`SOLAX_CLIENT_SECRET` instead of `SOLAX_API_TOKEN`, then `npm start`.
Expected: a reading line printed immediately and every `SOLAX_POLL_INTERVAL_MS`, same format as before — this time obtained via an automatically-fetched OAuth token instead of a manually-pasted one.

- [ ] **Step 7: Commit**

```bash
git add src/index.js .env.example README.md
git commit -m "feat: authenticate via OAuth client_credentials instead of a manual token"
```

---

## Self-Review Notes

- **Spec coverage:** auth endpoint + distinct success code (Task 1), proactive caching with the 5-minute buffer (Task 2), wiring + config rename + docs (Task 3). All spec sections have a task.
- **Placeholder scan:** no TBD/TODO; every step has literal code or an exact command.
- **Type consistency:** `fetchAccessToken({ clientId, clientSecret, baseUrl, fetchImpl })` in Task 1 matches its use as `fetchAccessTokenImpl` in Task 2's default parameter and test mocks (same field names: `accessToken`, `expiresInSeconds`). `createAccessTokenCache({ clientId, clientSecret, fetchAccessTokenImpl, now })` in Task 2 matches its Task 3 call site (`createAccessTokenCache({ clientId, clientSecret })`, relying on defaults) and `getAccessToken()` matches its Task 3 call site inside `pollOnce`.
