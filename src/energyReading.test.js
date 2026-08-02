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

test('defaults missing acPower2/acPower3 to 0 for single-phase-like records instead of producing NaN', () => {
  const rawDeviceRecord = {
    plantLocalTime: '2026-01-01 10:00:00',
    acPower1: 1000,
    // acPower2 and acPower3 omitted, as on single-phase inverters
    gridPower: 0,
    dailyYield: 5,
    todayExportEnergy: 0,
    todayImportEnergy: 0,
  };

  const reading = toEnergyReading(rawDeviceRecord);

  assert.equal(reading.solarProductionWatts, 1000);
  assert.equal(Number.isNaN(reading.solarProductionWatts), false);
});

test('defaults a null gridPower to 0 for systems without a grid meter instead of producing NaN', () => {
  const rawDeviceRecord = {
    plantLocalTime: '2026-01-01 10:00:00',
    acPower1: 500,
    acPower2: 500,
    acPower3: 0,
    gridPower: null,
    dailyYield: 5,
    todayExportEnergy: 0,
    todayImportEnergy: 0,
  };

  const reading = toEnergyReading(rawDeviceRecord);

  assert.equal(reading.houseConsumptionWatts, 1000);
  assert.equal(Number.isNaN(reading.houseConsumptionWatts), false);
});

test('sums numeric fields arriving as JSON strings instead of concatenating them', () => {
  const rawDeviceRecord = {
    plantLocalTime: '2026-01-01 10:00:00',
    acPower1: '1000',
    acPower2: '500',
    acPower3: 0,
    gridPower: 0,
    dailyYield: '5',
    todayExportEnergy: '2',
    todayImportEnergy: '0.5',
  };

  const reading = toEnergyReading(rawDeviceRecord);

  assert.equal(reading.solarProductionWatts, 1500);
  assert.equal(reading.dailyConsumptionKwh, 3.5);
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
