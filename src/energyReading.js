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
