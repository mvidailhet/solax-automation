# SolaX Cloud Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Node.js script that polls the SolaX Cloud Open API every 60 seconds for one inverter and prints solar production and house consumption (now + today) to the console.

**Architecture:** Two pure/isolated modules (`solaxClient.js` for HTTP, `energyReading.js` for the production/consumption math) consumed by a thin polling loop in `index.js`. This keeps the no-battery domain formulas testable without mocking the network, and the HTTP call testable without real credentials.

**Tech Stack:** Node.js 18+, ESM (`"type": "module"`), built-in `fetch`, built-in `node:test` + `node:assert/strict` for tests, `dotenv` as the only runtime dependency.

## Global Constraints

- Node.js 18+ (built-in `fetch` and `node:test`).
- ESM only (`"type": "module"` in `package.json`).
- No HTTP client dependency — use built-in `fetch`.
- `dotenv` is the only runtime dependency.
- Single device only (`SOLAX_DEVICE_SN` holds one serial) — multiple devices are out of scope for this plan.
- No persistence (file/DB logging) — console output only, out of scope for this plan.
- Secrets (`SOLAX_API_TOKEN`, `SOLAX_DEVICE_SN`) come from a gitignored `.env`; `.env.example` is the committed template. `.gitignore` in this repo already ignores `.env`/`.env.*` (and keeps `.env.example`), so no `.gitignore` changes are needed.
- API success code is `10000` (`code` field in the JSON body); anything else is a failure and the body's `message` describes it.
- `gridPower`: **positive = export, negative = import**, unit W (`businessType=1`).
- Formulas (no battery):
  - production now = `acPower1 + acPower2 + acPower3`
  - consumption now = production now − `gridPower`
  - production today = `dailyYield`
  - consumption today = `dailyYield − todayExportEnergy + todayImportEnergy`

---

## File Structure

- `package.json` — project manifest: `"type": "module"`, `dotenv` dependency, `start`/`test` scripts.
- `.env.example` — template listing `SOLAX_API_TOKEN`, `SOLAX_DEVICE_SN`, `SOLAX_POLL_INTERVAL_MS`.
- `src/solaxClient.js` — `fetchRealtimeData(deviceSn, options)`: calls the SolaX realtime_data endpoint, returns the first device record, throws on API-level failure.
- `src/solaxClient.test.js` — tests `fetchRealtimeData` against an injected fake `fetch`.
- `src/energyReading.js` — `toEnergyReading(rawDeviceRecord)`: pure mapping from a raw device record to `{ timestamp, solarProductionWatts, houseConsumptionWatts, dailyProductionKwh, dailyConsumptionKwh }`.
- `src/energyReading.test.js` — tests the production/consumption formulas, including the import vs. export sign cases.
- `src/index.js` — reads config from `process.env`, runs the poll loop, formats and prints each reading.

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Produces: an ESM Node project with `dotenv` installed, a `test` script running `node --test`, and a `start` script running `src/index.js`. Later tasks import from `dotenv` and run under `node --test`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "solax-automation",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test src"
  },
  "dependencies": {
    "dotenv": "^16.4.5"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` created, no errors.

- [ ] **Step 3: Write `.env.example`**

```
SOLAX_API_TOKEN=your-solax-cloud-api-token
SOLAX_DEVICE_SN=your-inverter-or-dongle-serial-number
SOLAX_POLL_INTERVAL_MS=60000
```

- [ ] **Step 4: Update `README.md`**

```markdown
# solax-automation

Polls the SolaX Cloud Open API for one inverter and prints solar production
and house consumption to the console.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `SOLAX_API_TOKEN` and
   `SOLAX_DEVICE_SN` from your SolaX Cloud account.
3. `npm start`

## Test

`npm test`
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example README.md
git commit -m "chore: scaffold solax-automation Node project"
```

---

### Task 2: SolaX API client

**Files:**
- Create: `src/solaxClient.js`
- Test: `src/solaxClient.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `fetchRealtimeData(deviceSn, { token, baseUrl, fetchImpl })` — an async function returning the raw first device record (a plain object with fields like `acPower1`, `gridPower`, `dailyYield`, etc., as documented in the spec). `baseUrl` defaults to `https://openapi-eu.solaxcloud.com/openapi`, `fetchImpl` defaults to the global `fetch`. Throws `Error` with the API's `message` when the response `code` is not `10000`. Task 4 (`index.js`) calls this with `{ token }` only.

- [ ] **Step 1: Write the failing tests**

Create `src/solaxClient.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/solaxClient.js` does not exist / export not found.

- [ ] **Step 3: Write the implementation**

Create `src/solaxClient.js`:

```js
const DEFAULT_BASE_URL = 'https://openapi-eu.solaxcloud.com/openapi';
const REALTIME_DATA_PATH = '/v2/device/realtime_data';
const API_SUCCESS_CODE = 10000;
const SINGLE_PHASE_DEVICE_TYPE = 1;
const WATT_UNIT_BUSINESS_TYPE = 1;

export async function fetchRealtimeData(
  deviceSn,
  { token, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = {}
) {
  const url =
    `${baseUrl}${REALTIME_DATA_PATH}` +
    `?snList=${deviceSn}&deviceType=${SINGLE_PHASE_DEVICE_TYPE}&businessType=${WATT_UNIT_BUSINESS_TYPE}`;

  const response = await fetchImpl(url, {
    headers: { Authorization: `bearer ${token}` },
  });
  const body = await response.json();

  if (body.code !== API_SUCCESS_CODE) {
    throw new Error(body.message ?? `SolaX API error (code ${body.code})`);
  }

  return body.result[0];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 3 tests in `src/solaxClient.test.js` green.

- [ ] **Step 5: Commit**

```bash
git add src/solaxClient.js src/solaxClient.test.js
git commit -m "feat: add SolaX realtime_data API client"
```

---

### Task 3: Energy reading domain mapping

**Files:**
- Create: `src/energyReading.js`
- Test: `src/energyReading.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure function; the shape it accepts matches the raw device record `fetchRealtimeData` from Task 2 returns — fields `acPower1`, `acPower2`, `acPower3`, `gridPower`, `dailyYield`, `todayExportEnergy`, `todayImportEnergy`, `plantLocalTime`).
- Produces: `toEnergyReading(rawDeviceRecord)` returning `{ timestamp, solarProductionWatts, houseConsumptionWatts, dailyProductionKwh, dailyConsumptionKwh }`. Task 4 (`index.js`) calls this and formats its return value for printing.

- [ ] **Step 1: Write the failing tests**

Create `src/energyReading.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEnergyReading } from './energyReading.js';

test('computes consumption by subtracting grid export from production', () => {
  const rawDeviceRecord = {
    plantLocalTime: '2026-01-01 10:00:00',
    acPower1: 1000,
    acPower2: 0,
    acPower3: 0,
    gridPower: 400, // exporting 400W
    dailyYield: 5,
    todayExportEnergy: 2,
    todayImportEnergy: 0.5,
  };

  const reading = toEnergyReading(rawDeviceRecord);

  assert.equal(reading.solarProductionWatts, 1000);
  assert.equal(reading.houseConsumptionWatts, 600);
});

test('computes consumption by adding grid import when gridPower is negative', () => {
  const rawDeviceRecord = {
    plantLocalTime: '2026-01-01 20:00:00',
    acPower1: 0,
    acPower2: 0,
    acPower3: 0,
    gridPower: -800, // importing 800W
    dailyYield: 5,
    todayExportEnergy: 2,
    todayImportEnergy: 3,
  };

  const reading = toEnergyReading(rawDeviceRecord);

  assert.equal(reading.solarProductionWatts, 0);
  assert.equal(reading.houseConsumptionWatts, 800);
});

test('computes daily production and consumption from cumulative energy fields', () => {
  const rawDeviceRecord = {
    plantLocalTime: '2026-01-01 12:00:00',
    acPower1: 500,
    acPower2: 500,
    acPower3: 500,
    gridPower: 0,
    dailyYield: 10,
    todayExportEnergy: 3,
    todayImportEnergy: 1,
  };

  const reading = toEnergyReading(rawDeviceRecord);

  assert.equal(reading.dailyProductionKwh, 10);
  assert.equal(reading.dailyConsumptionKwh, 8);
});

test('carries the plant-local timestamp through unchanged', () => {
  const rawDeviceRecord = {
    plantLocalTime: '2026-01-01 12:00:00',
    acPower1: 0,
    acPower2: 0,
    acPower3: 0,
    gridPower: 0,
    dailyYield: 0,
    todayExportEnergy: 0,
    todayImportEnergy: 0,
  };

  const reading = toEnergyReading(rawDeviceRecord);

  assert.equal(reading.timestamp, '2026-01-01 12:00:00');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/energyReading.js` does not exist / export not found.

- [ ] **Step 3: Write the implementation**

Create `src/energyReading.js`:

```js
export function toEnergyReading(rawDeviceRecord) {
  const solarProductionWatts =
    rawDeviceRecord.acPower1 + rawDeviceRecord.acPower2 + rawDeviceRecord.acPower3;
  const houseConsumptionWatts = solarProductionWatts - rawDeviceRecord.gridPower;

  const dailyProductionKwh = rawDeviceRecord.dailyYield;
  const dailyConsumptionKwh =
    rawDeviceRecord.dailyYield -
    rawDeviceRecord.todayExportEnergy +
    rawDeviceRecord.todayImportEnergy;

  return {
    timestamp: rawDeviceRecord.plantLocalTime,
    solarProductionWatts,
    houseConsumptionWatts,
    dailyProductionKwh,
    dailyConsumptionKwh,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 4 tests in `src/energyReading.test.js` green, plus the 3 from Task 2 still green.

- [ ] **Step 5: Commit**

```bash
git add src/energyReading.js src/energyReading.test.js
git commit -m "feat: add production/consumption energy reading mapping"
```

---

### Task 4: Polling loop entry point

**Files:**
- Create: `src/index.js`

**Interfaces:**
- Consumes: `fetchRealtimeData(deviceSn, { token })` from Task 2 (`src/solaxClient.js`); `toEnergyReading(rawDeviceRecord)` from Task 3 (`src/energyReading.js`).
- Produces: the runnable entry point (`npm start`). No further tasks depend on this one.

This task is thin orchestration (env reading, timer, console formatting) and is verified manually against the real API rather than unit tested, per the spec.

- [ ] **Step 1: Write `src/index.js`**

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
  const pollIntervalMs = Number(process.env.SOLAX_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS);

  pollOnce(deviceSn, token);
  setInterval(() => pollOnce(deviceSn, token), pollIntervalMs);
}

main();
```

- [ ] **Step 2: Manually verify against the real API**

Run: `cp .env.example .env`, fill in your real `SOLAX_API_TOKEN` and `SOLAX_DEVICE_SN`, then `npm start`.
Expected: a line like `[2026-08-02 14:32:10] production=1234W consumption=567W | today production=8.4kWh consumption=6.1kWh` printed immediately, then again every `SOLAX_POLL_INTERVAL_MS`. A deliberately wrong token should print a `Poll failed: ...` line using the API's error message instead of crashing.

- [ ] **Step 3: Run the full test suite one last time**

Run: `npm test`
Expected: PASS — all 7 tests (3 client + 4 energy reading) green.

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat: add polling loop entry point"
```

---

## Self-Review Notes

- **Spec coverage:** config (Task 1), API client + `code`/`message` handling (Task 2), production/consumption formulas incl. export/import sign (Task 3), polling loop with per-tick error handling (Task 4). All spec sections have a task.
- **Placeholder scan:** no TBD/TODO; every step has literal code or an exact command.
- **Type consistency:** `fetchRealtimeData(deviceSn, { token, baseUrl, fetchImpl })` in Task 2 matches its Task 4 call site (`{ token }`); `toEnergyReading(rawDeviceRecord)` in Task 3 matches its Task 4 call site and field names (`acPower1..3`, `gridPower`, `dailyYield`, `todayExportEnergy`, `todayImportEnergy`, `plantLocalTime`).
