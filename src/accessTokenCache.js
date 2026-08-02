import { fetchAccessToken } from './solaxAuth.js';

const REFRESH_BUFFER_MS = 300000;

export function createAccessTokenCache({
  clientId,
  clientSecret,
  fetchAccessTokenImpl = fetchAccessToken,
  now = Date.now,
}) {
  let cachedToken = null;
  let cachedTokenExpiresAt = 0;

  async function getAccessToken() {
    if (cachedToken && now() < cachedTokenExpiresAt) {
      return cachedToken;
    }

    const { accessToken, expiresInSeconds } = await fetchAccessTokenImpl({
      clientId,
      clientSecret,
    });

    cachedToken = accessToken;
    cachedTokenExpiresAt = now() + expiresInSeconds * 1000 - REFRESH_BUFFER_MS;

    return cachedToken;
  }

  return { getAccessToken };
}
