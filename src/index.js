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
