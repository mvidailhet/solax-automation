function toNumber(value) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

export function toEnergyReading(rawDeviceRecord) {
  const acPower1 = toNumber(rawDeviceRecord.acPower1);
  const acPower2 = toNumber(rawDeviceRecord.acPower2);
  const acPower3 = toNumber(rawDeviceRecord.acPower3);
  const gridPower = toNumber(rawDeviceRecord.gridPower);
  const dailyYield = toNumber(rawDeviceRecord.dailyYield);
  const todayExportEnergy = toNumber(rawDeviceRecord.todayExportEnergy);
  const todayImportEnergy = toNumber(rawDeviceRecord.todayImportEnergy);

  const solarProductionWatts = acPower1 + acPower2 + acPower3;
  const houseConsumptionWatts = solarProductionWatts - gridPower;

  const dailyProductionKwh = dailyYield;
  const dailyConsumptionKwh = dailyYield - todayExportEnergy + todayImportEnergy;

  return {
    timestamp: rawDeviceRecord.plantLocalTime,
    solarProductionWatts,
    houseConsumptionWatts,
    dailyProductionKwh,
    dailyConsumptionKwh,
  };
}
