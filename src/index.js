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
