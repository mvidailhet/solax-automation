# SolaX Cloud OAuth Access Token — Design

## Purpose

Replace the manually-obtained `SOLAX_API_TOKEN` with an access token the
script fetches and refreshes on its own, using the SolaX Cloud OAuth
`client_credentials` grant. This removes the manual "go copy a token from
the dashboard" step and lets the script run unattended indefinitely.

## Why `client_credentials`, not `authorization_code`

The token endpoint documents two grant types:

- `authorization_code` — for third-party apps that need arbitrary **other**
  SolaX users to log in and grant access via a browser redirect (`code` +
  `redirect_uri`). Not our case: this script only ever accesses its own
  account's data.
- `client_credentials` — the app authenticates as itself, using only
  `client_id`/`client_secret`. No browser step, no `redirect_uri`. Verified
  directly against the real API: it works for this account's registered
  app, and the returned scope (`API_Telemetry_V2`, `API_Overall_V2`, etc.)
  covers the device telemetry this project already reads.

## API reference

- Endpoint: `POST https://openapi-eu.solaxcloud.com/openapi/auth/oauth/token`
- Content type: `application/x-www-form-urlencoded`
- Body: `client_id`, `client_secret`, `grant_type=client_credentials`
- Success response:
  ```json
  {
    "code": 0,
    "result": {
      "access_token": "...",
      "token_type": "Bearer",
      "expires_in": 2591999,
      "scope": "API_Telemetry_V2 ...",
      "grant_type": "client_credentials",
      "auth_station": "all"
    }
  }
  ```
- **Success code for this endpoint is `0`** — distinct from `realtime_data`'s
  `10000`. Each client module owns its own success-code constant; they are
  not shared.
- `expires_in` is in seconds (~2,591,999s ≈ 30 days in the confirmed
  response). No `refresh_token` is issued or needed for this grant — a new
  token is obtained the same way (`client_id`/`client_secret`) when the old
  one is close to expiry.
- Failure: non-`0` `code`; body's `message` describes the error (same
  convention as `realtime_data`).

## Configuration

`.env` (and `.env.example`) changes:

| Variable | Meaning |
|---|---|
| `SOLAX_CLIENT_ID` | Replaces `SOLAX_API_TOKEN`. OAuth client ID from the SolaX developer app. |
| `SOLAX_CLIENT_SECRET` | OAuth client secret from the SolaX developer app. |

`SOLAX_API_TOKEN` is removed — no backward-compatibility fallback; this is
a personal script, not a public library.

## Structure

- `src/solaxAuth.js` — `fetchAccessToken({ clientId, clientSecret, baseUrl, fetchImpl })`:
  posts the form-encoded `client_credentials` request, checks `code === 0`,
  returns `{ accessToken, expiresInSeconds }`. Throws using the API's
  `message` on failure. Mirrors `solaxClient.js`'s shape (default `baseUrl`,
  injectable `fetchImpl` for tests) but is otherwise independent of it — no
  shared code, since the two endpoints have different success codes and
  response shapes.
- `src/accessTokenCache.js` — the one stateful piece in this feature.
  `createAccessTokenCache({ clientId, clientSecret, fetchAccessTokenImpl, now })`
  returns `{ getAccessToken(): Promise<string> }`. On first call, fetches a
  token and remembers `accessToken` + the absolute time it expires
  (`now() + expiresInSeconds * 1000 - REFRESH_BUFFER_MS`, where
  `REFRESH_BUFFER_MS` is a named constant set to 5 minutes / 300000ms).
  Subsequent calls
  return the cached token if `now()` is still before that time; otherwise
  fetch a fresh token and update the cache. `fetchAccessTokenImpl` defaults
  to `fetchAccessToken` from `solaxAuth.js`; `now` defaults to `Date.now`
  — both injectable so tests can simulate expiry without real waiting or
  network calls.
- `src/index.js` changes:
  - Reads `SOLAX_CLIENT_ID` and `SOLAX_CLIENT_SECRET` via `requireEnv`
    instead of `SOLAX_API_TOKEN`.
  - Creates one `accessTokenCache` at startup via
    `createAccessTokenCache({ clientId, clientSecret })`.
  - `pollOnce` calls `await accessTokenCache.getAccessToken()` before
    `fetchRealtimeData`, and passes that token as `{ token }`.
  - The first token fetch happens as part of the first `pollOnce()` call at
    startup (no separate startup-only code path) — a failure there is
    caught by the same per-tick try/catch as any other poll failure, logged,
    and retried on the next tick. This matches the existing "transient
    failures shouldn't kill the loop" design; a persistently wrong
    `client_id`/`client_secret` will show as a repeating logged error every
    tick, which is enough signal for a personal script (no separate
    fail-fast startup path is needed beyond the existing `requireEnv`
    checks for the two new variables).
- No changes to `src/solaxClient.js` or `src/energyReading.js` — untouched,
  still receive/produce exactly what they did before.

## Testing

- `solaxAuth.js`: unit tests against an injected fake `fetch`, mirroring
  `solaxClient.test.js`'s pattern — success returns the mapped
  `{ accessToken, expiresInSeconds }`; non-`0` code throws using the body's
  `message`; the request sends the correct form-encoded body and content
  type.
- `accessTokenCache.js`: unit tests using an injected fake
  `fetchAccessTokenImpl` and an injected `now`, locking the *behavior*
  (fetch once, reuse while valid, refetch once the buffer window is
  reached) rather than pinning to real token values or real time.

## Out of scope

- `refresh_token` handling (not applicable to `client_credentials`).
- The `authorization_code` browser flow (not needed for this project).
- Retrying/backoff logic for auth failures beyond what the existing
  per-tick catch already provides.
