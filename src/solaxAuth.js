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

  const accessToken = responseBody.result?.access_token;
  const expiresInSeconds = responseBody.result?.expires_in;

  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('SolaX auth response is missing a valid access_token');
  }
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error('SolaX auth response is missing a valid expires_in');
  }

  return { accessToken, expiresInSeconds };
}
