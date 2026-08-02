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

  const [deviceRecord] = body.result ?? [];
  if (!deviceRecord) {
    throw new Error(`SolaX API returned no device data for ${deviceSn}`);
  }
  return deviceRecord;
}
