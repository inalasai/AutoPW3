import type {
  ConnectTeslaRequest,
  ConnectTeslaResponse,
  CreateSiteRequest,
  DiscoveredSitesResponse,
} from '@autopw3/shared';
import type { Repository } from '../db/repository';
import type { Env } from '../env';
import { errorResponse, jsonResponse } from '../lib/errors';
import type { ITeslaClient } from '../providers/tesla/client';
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  generateCodeVerifier,
  type OAuthStateStore,
} from '../providers/tesla/oauth';
import type { TokenStore } from '../services/tokens/store';

export async function handleConnectTesla(
  householdId: string,
  body: ConnectTeslaRequest,
  userId: string,
  env: Env,
  stateStore: OAuthStateStore,
  requestId: string,
): Promise<Response> {
  const clientId = env.TESLA_CLIENT_ID;
  const redirectUri = env.TESLA_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return errorResponse(
      'PROVIDER_UNAVAILABLE',
      'Tesla OAuth integration is not configured on this server',
      requestId,
    );
  }

  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier(64);
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  await stateStore.saveState({
    state,
    userId,
    householdId,
    codeVerifier,
    expiresAt,
  });

  const scopes = ['openid', 'offline_access', 'energy_device_data'];
  if (body.enableControls) {
    scopes.push('energy_cmds');
  }

  const { url } = await buildAuthorizeUrl({
    clientId,
    redirectUri,
    state,
    codeVerifier,
    scopes,
  });

  const response: ConnectTeslaResponse = { authorizeUrl: url };
  return jsonResponse(response, 200, requestId);
}

export async function handleTeslaCallback(
  query: { code: string; state: string },
  env: Env,
  stateStore: OAuthStateStore,
  tokenStore: TokenStore,
  repo: Repository,
  teslaClient: ITeslaClient,
  requestId: string,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const { code, state } = query;

  const oauthState = await stateStore.consumeState(state);
  if (!oauthState) {
    return errorResponse(
      'VALIDATION_FAILED',
      'Invalid or expired OAuth state parameter (CSRF protection)',
      requestId,
      [{ path: 'state', issue: 'invalid_or_expired' }],
    );
  }

  const clientId = env.TESLA_CLIENT_ID;
  const clientSecret = env.TESLA_CLIENT_SECRET;
  const redirectUri = env.TESLA_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return errorResponse(
      'PROVIDER_UNAVAILABLE',
      'Tesla OAuth credentials missing on server',
      requestId,
    );
  }

  let tokenData;
  try {
    tokenData = await exchangeAuthorizationCode(
      {
        clientId,
        clientSecret,
        redirectUri,
        code,
        codeVerifier: oauthState.codeVerifier,
      },
      fetcher,
    );
  } catch (err) {
    return errorResponse(
      'VALIDATION_FAILED',
      `Failed to exchange Tesla authorization code: ${err instanceof Error ? err.message : String(err)}`,
      requestId,
    );
  }

  // Discover region & fleetApiBaseUrl
  let regionBaseUrl = 'https://fleet-api.prd.na.vn.cloud.tesla.com';
  try {
    const regionInfo = await teslaClient.getRegion(tokenData.access_token);
    regionBaseUrl = regionInfo.fleetApiBaseUrl;
  } catch {
    // Fall back to default
  }

  // Persist encrypted tokens (Operation S4)
  const expiresAt = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 28800);
  await tokenStore.saveTokens(oauthState.householdId, {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt,
    tokenType: tokenData.token_type,
    scope: tokenData.scope,
    regionBaseUrl,
  });

  // Update repository link state
  const scopesArray = tokenData.scope.split(' ').filter(Boolean);
  await repo.setTeslaLink(oauthState.householdId, {
    state: 'ACTIVE',
    scopes: scopesArray,
    lastRefreshAt: new Date().toISOString(),
  });

  // 302 redirect back to the app settings per contract §2.3
  return new Response(null, {
    status: 302,
    headers: {
      location: `/settings?tesla=connected&hid=${oauthState.householdId}`,
      'x-request-id': requestId,
    },
  });
}

export async function handleGetTeslaLink(
  householdId: string,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const link = await repo.getTeslaLink(householdId);
  return jsonResponse(link, 200, requestId);
}

export async function handleListDiscoveredSites(
  householdId: string,
  tokenStore: TokenStore,
  teslaClient: ITeslaClient,
  requestId: string,
): Promise<Response> {
  const tokens = await tokenStore.getTokens(householdId);
  if (!tokens) {
    return errorResponse('CONFLICT', 'No active Tesla account linked to this household', requestId);
  }

  try {
    const discovered = await teslaClient.listProducts(tokens.regionBaseUrl, tokens.accessToken);
    const response: DiscoveredSitesResponse = {
      items: discovered.map((d) => ({
        providerSiteId: d.energySiteId,
        name: d.siteName,
      })),
    };
    return jsonResponse(response, 200, requestId);
  } catch (err) {
    return errorResponse(
      'PROVIDER_UNAVAILABLE',
      `Failed to list Tesla energy sites: ${err instanceof Error ? err.message : String(err)}`,
      requestId,
    );
  }
}

export async function handleCreateSite(
  householdId: string,
  body: CreateSiteRequest,
  repo: Repository,
  requestId: string,
): Promise<Response> {
  const site = await repo.createSite(householdId, body);
  return jsonResponse(site, 201, requestId);
}

export async function handleDisconnectTesla(
  householdId: string,
  repo: Repository,
  tokenStore: TokenStore,
  requestId: string,
): Promise<Response> {
  await tokenStore.deleteTokens(householdId);
  await repo.disconnectTesla(householdId);
  return new Response(null, {
    status: 204,
    headers: {
      'x-request-id': requestId,
    },
  });
}
