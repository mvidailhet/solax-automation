# SolaX Cloud Monitor — Design

## Purpose

A small Node.js script that continuously polls the SolaX Cloud Open API for one
inverter/dongle and prints solar production and house consumption to the
console, in near-real-time.

## System assumptions

- Single inverter/dongle (`deviceSn`), no battery, no EV charger.
- No battery means production and consumption can be derived purely from AC
  power and the grid meter, without needing battery charge/discharge data.

## API reference (SolaX Cloud Open API, EU)

- Base URL: `https://openapi-eu.solaxcloud.com/openapi`
- Endpoint: `GET /v2/device/realtime_data?snList={deviceSn}&deviceType=1&businessType=1`
- Auth: `Authorization: bearer {token}` header
- Success response: `{ "code": 10000, "result": [ { ...device fields } ] }`
- Non-`10000` `code` indicates failure; `message` holds the error text.
- `businessType=1` selects Watt/kWh units (vs `businessType=4` for kW).

### Relevant response fields (result[0])

| Field | Meaning | Unit |
|---|---|---|
| `acPower1`, `acPower2`, `acPower3` | Instantaneous AC output power per phase | W |
| `dailyYield` | Today's cumulative PV yield | kWh |
| `totalYield` | Lifetime cumulative PV yield | kWh |
| `gridPower` | Meter 1 grid port power. **Positive = export, negative = import** | W |
| `todayImportEnergy` | Today's energy imported from grid | kWh |
| `todayExportEnergy` | Today's energy exported to grid | kWh |
| `plantLocalTime` | Reading timestamp, plant-local time | string |

## Domain formulas (no battery)

- **Solar production now** = `acPower1 + acPower2 + acPower3`
- **House consumption now** = production − `gridPower`
  (exporting subtracts the surplus; importing, being negative, adds the deficit)
- **Solar production today** = `dailyYield`
- **House consumption today** = `dailyYield − todayExportEnergy + todayImportEnergy`

## Configuration

Loaded from a gitignored `.env` file (`.env.example` committed as the template):

| Variable | Meaning | Default |
|---|---|---|
| `SOLAX_API_TOKEN` | Bearer token from SolaX Cloud account | — (required) |
| `SOLAX_DEVICE_SN` | Inverter/dongle serial number | — (required) |
| `SOLAX_POLL_INTERVAL_MS` | Delay between polls | `60000` |

## Structure

- `src/solaxClient.js` — `fetchRealtimeData(deviceSn)`: calls the endpoint,
  returns `result[0]`. Throws when `code !== 10000`, using the API's
  `message`.
- `src/energyReading.js` — `toEnergyReading(rawDeviceRecord)`: maps a raw
  device record into `{ timestamp, solarProductionWatts,
  houseConsumptionWatts, dailyProductionKwh, dailyConsumptionKwh }` using the
  formulas above. Isolates the domain math (and the no-battery assumption)
  from HTTP/plumbing concerns.
- `src/index.js` — polling loop: every `SOLAX_POLL_INTERVAL_MS`, fetch, map,
  print one line. Per-tick fetch errors are caught and logged; the loop
  continues (a transient network/API hiccup should not stop continuous
  monitoring).

## Stack

- Plain Node.js 18+, ESM.
- No HTTP dependency — built-in `fetch`.
- `dotenv` as the only runtime dependency, to load `.env`.

## Testing

- `energyReading.js`'s formulas are pure functions — unit test them directly
  against representative raw records (export-only, import-only, zero-grid)
  to lock in the production/consumption relationship, not exact numbers.
- `solaxClient.js` is tested against a mocked `fetch` for the success and
  non-`10000` failure paths.
- `index.js` (the loop) is thin orchestration and is not unit tested;
  correctness is covered by the two modules above plus manual verification
  against the real API.

## Out of scope (for this first version)

- Multiple devices / `snList` with more than one serial.
- Persisting readings to a file or database.
- Battery/EV charger fields.
