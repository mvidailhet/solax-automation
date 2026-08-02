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

  return {
    accessToken: responseBody.result.access_token,
    expiresInSeconds: responseBody.result.expires_in,
  };
}
